import { type InvoiceTextReading } from "./collection/invoice-text.js";
import { readUploadText } from "./collection/upload-text.js";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { Prisma } from "@acropora/database";
import {
  ACROPORA_COMPANY,
  type AuthenticatedUser,
  type MissingInvoiceAction,
  type MissingInvoiceDuplicateResult,
  type MissingInvoiceDuplicatesResponse,
  type MissingInvoiceCandidateDiagnosis,
  type MissingInvoiceItemDetail,
  type SupplierInvoiceImportResult,
  type MissingInvoiceItem,
  type MissingInvoiceMonth,
  type MissingInvoiceMonthDetail,
  type MissingInvoiceMonthQuery,
  type MissingInvoiceMonthsResponse,
  type MissingInvoiceMonthStatus,
  type MissingInvoicePackageCheck,
  type MissingInvoicePackagePdf,
  MISSING_INVOICE_PACKAGE_PDF_LACKING,
} from "@acropora/types";

import { isPrismaUniqueConstraintViolation } from "../common/prisma-error.util.js";
import { createHash } from "node:crypto";

import { SupplierInvoiceImportService } from "../purchasing/supplier-invoice-import/supplier-invoice-import.service.js";
import { pdfTextLines } from "../purchasing/supplier-invoice-import/pdf-text-lines.js";
import {
  classifyTransaction,
  NO_INVOICE_CATEGORIES,
  payrollNamesOf,
  type BankCategory,
} from "./bank-transaction.classify.js";
import { ownInvoiceRefund } from "./own-invoice-refund.js";
import {
  amountGap,
  CANDIDATE_NAME_THRESHOLD,
  exact,
  inWindow,
  matchMonth,
  mergeManualUploads,
  samePartner,
  shownNumber,
  type CandidateDocument,
  type ItemState,
  type MatchOutcome,
} from "./missing-invoice-matching.js";
import {
  FOXPOST_TAX_BASE,
  GLS_TAX_BASE,
  MissingInvoicesRepository,
  normalizeAccount,
  queryExclusion,
} from "./missing-invoices.repository.js";
import { originalAmountOf } from "./otp-statement.parser.js";
import { payeeFromText } from "./payee-check.js";
import { sortMissingInvoiceItems } from "./missing-invoice-sort.js";
import {
  buildAccountantPackage,
  headOutcomes,
} from "./missing-invoices-package.pdf.js";
import {
  inFeedTest,
  notInFeedTest,
  paperOriginalOfRow,
  pairingNumberKeys,
} from "../billing/incoming-billing-documents.js";
import { invoiceIdentity, sameGross } from "../billing/invoice-identity.js";
import {
  packageDataNote,
  storedValues,
} from "../billing/foreign-invoice/reading-values.js";
import { buildMissingInvoicesXlsx } from "./missing-invoices-xlsx.js";
import {
  freeDocuments,
  jevPairInput,
} from "./missing-invoice-jev-candidates.js";
import {
  MissingInvoiceJevService,
  type PairSuggestion,
} from "./missing-invoice-jev.service.js";

/** A „Hiányzik” fül és a Hiányos hónap: minden, amihez teendő van. */
/** A környezet (a Drive-mappa hivatkozása); a teszt ezen át adja. */
export const MISSING_INVOICES_ENV = Symbol("MISSING_INVOICES_ENV");

const MISSING_STATES: ReadonlySet<ItemState> = new Set([
  "ORIGINAL_MISSING",
  "NOT_MATCHED",
  "NO_INVOICE",
  "NOT_COMPANY",
  "PROFORMA_ONLY",
  "DOUBLE_PAID",
  "REFUND_MISSING",
]);
// a kétszer fizetett tételnek sincs saját számlája: a „Nincs számla” csempébe
// számít, és a hiányzó összegbe is (acrobot 25636)
const NO_INVOICE_TILE: ReadonlySet<ItemState> = new Set([
  "NO_INVOICE",
  "NOT_COMPANY",
  "PROFORMA_ONLY",
  "DOUBLE_PAID",
  // az elmaradt visszatérítés a Nincs számla mellé (acrobot 25933)
  "REFUND_MISSING",
]);
// a várt visszatérítés a Nem kell számla mellé számít (acrobot 25933)
const NO_INVOICE_NEEDED_TILE: ReadonlySet<ItemState> = new Set([
  "NO_INVOICE_NEEDED",
  "REFUND_EXPECTED",
]);

/** A tétel-lista lapmérete, ha a kérés nem ad (szerződés: 1..100, 25). */
const DEFAULT_PAGE_SIZE = 25;

const monthOf = (date: Date) => date.toISOString().slice(0, 7);
const dayOf = (date: Date) => date.toISOString().slice(0, 10);

function shiftMonth(month: string, by: number): string {
  const total =
    Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + by;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/** Egy forrás-dokumentum párosítása (a Számlázás „Bejövő számlák” nézetéhez). */
export interface DocumentPairing {
  payee: CandidateDocument["payee"];
  kind: CandidateDocument["kind"];
  debits: {
    bookingDate: string;
    amount: string;
    currency: string;
    /** a bank által közölt eredeti összeg, ha a terhelés átváltott (az automatikus jóváhagyásnak) */
    original?: { amount: string; currency: string } | null;
  }[];
  /**
   * A TERHELÉSEK A TELJES SZÁMLÁT FIZETIK (murena lelete, 26014): minden
   * párosított terhelés Megvan vagy Eredeti hiányzik, összeg-eltérés nélkül.
   * A párosítás összeg-eltéréssel is megáll (a számlaszám-szabály és a kézi
   * párosítás bármilyen összeggel párosít), és a kétszer fizetett vagy a
   * sztornózott vásárlás jóváírója is párosított; ezek NEM teljes fizetések.
   */
  paidInFull: boolean;
  /**
   * A párosított terhelések valamelyikén „Papíron megvan” jelölés áll (#2000):
   * a számla bejövő számla sora ezt örökli.
   */
  paperOriginal: boolean;
  /**
   * A párosított dokumentum maga (aliasaival). A „Bejövő számlák” ebből
   * mutatja a feedben NEM szereplő, csak postafiókból ismert számlát
   * (kártya 096607af, acrobot 26716).
   */
  document: CandidateDocument;
}

/** A betöltés ablaka: 12 hónap az első kivonat előtt, a következő hónap 15-éig. Egy helyen: a számítás és a jelölt-vizsgálat is ezt hívja. */
const candidateWindow = (first: string, last: string) => ({
  from: `${shiftMonth(first, -12)}-01`,
  to: `${shiftMonth(last, 1)}-15`,
});

interface Computed {
  items: (MissingInvoiceItem & { month: string; accountId: string })[];
  months: string[];
  accounts: {
    id: string;
    name: string;
    accountNumber: string;
    currency: string;
  }[];
  coverage: Set<string>;
  outcomes: Map<string, MatchOutcome>;
  documents: CandidateDocument[];
  /** A terhelesek a besorolasukkal: a Jev-javaslat bemenete. */
  classified: Classified[];
}

interface Classified {
  debit: Awaited<ReturnType<MissingInvoicesRepository["debits"]>>[number];
  classification: { category: BankCategory; rule: string };
  original: ReturnType<typeof originalAmountOf>;
}

/**
 * HIÁNYZÓ SZÁMLÁK: a hónapok és egy hónap tételei (brief 5-9. pont). Minden
 * állapot SZÁMOLT érték a kivonatból, a jelöltekből és a kézi döntésekből,
 * nem tárolt: így a számlálók egy kézi párosítás után maguktól frissülnek
 * (brief 19/8).
 *
 * A PÁROSÍTÁS AZ ÖSSZES HÓNAPRA EGYBEN FUT, időrendben: csak így igaz, hogy egy
 * számlát egy terhelés visz, hónapokon át is.
 */
/** A tétel legrosszabb számlája dönt: a hiányzó előbb, mint a meglévő. */
const PACKAGE_PDF_ORDER: readonly MissingInvoicePackagePdf[] = [
  "PDF_MISSING",
  "NO_FILE",
  "NOT_PDF",
  "ATTACHED",
  "PAPER",
];

@Injectable()
export class MissingInvoicesService {
  private readonly logger = new Logger(MissingInvoicesService.name);

  constructor(
    private readonly repository: MissingInvoicesRepository,
    private readonly reader: SupplierInvoiceImportService,
    @Optional()
    @Inject(MISSING_INVOICES_ENV)
    private readonly environment: NodeJS.ProcessEnv = process.env,
    @Optional()
    private readonly jev?: MissingInvoiceJevService,
  ) {}

  async months(): Promise<MissingInvoiceMonthsResponse> {
    const computed = await this.compute();
    const months: MissingInvoiceMonth[] = computed.months
      .map((month) => {
        const items = computed.items.filter((item) => item.month === month);
        const count = (states: ReadonlySet<ItemState> | ItemState) =>
          items.filter((item) =>
            typeof states === "string"
              ? item.state === states
              : states.has(item.state),
          ).length;
        const missingAccounts = this.missingStatementAccounts(computed, month);
        return {
          month,
          debitCount: items.filter((i) => !NO_INVOICE_NEEDED_TILE.has(i.state))
            .length,
          found: count("FOUND"),
          originalMissing: count("ORIGINAL_MISSING"),
          notMatched: count("NOT_MATCHED"),
          noInvoice: count(NO_INVOICE_TILE),
          noInvoiceNeeded: count(NO_INVOICE_NEEDED_TILE),
          missingAmountHuf: items
            .filter(
              (i) =>
                MISSING_STATES.has(i.state) &&
                i.state !== "ORIGINAL_MISSING" &&
                i.currency === "HUF",
            )
            .reduce((sum, i) => sum.plus(i.amount), new Prisma.Decimal(0))
            .toFixed(0),
          status: statusOf(
            missingAccounts.length,
            computed.accounts.length,
            count(MISSING_STATES),
          ),
          missingStatementAccounts: missingAccounts,
        };
      })
      .reverse();
    return {
      company: {
        name: ACROPORA_COMPANY.name,
        taxNumber: ACROPORA_COMPANY.taxNumberBase,
      },
      months,
    };
  }

  async month(
    month: string,
    query: MissingInvoiceMonthQuery,
  ): Promise<MissingInvoiceMonthDetail> {
    const computed = await this.compute();
    const all = computed.items.filter((item) => item.month === month);
    const q = query.q?.trim().toLowerCase();
    const tab = query.tab ?? "MISSING";
    // a „PDF nélkül” szűrő a csomag döntéséből jön (packageCheck), a lapozás ELŐTT
    const lacking =
      query.packagePdf === "MISSING"
        ? new Set(
            (await this.packageCheck(month)).items
              .filter((entry) =>
                MISSING_INVOICE_PACKAGE_PDF_LACKING.has(entry.pdf),
              )
              .map((entry) => entry.id),
          )
        : null;
    const filtered = all.filter(
      (item) =>
        (!lacking || lacking.has(item.id)) &&
        (tab === "ALL" ||
          (tab === "MISSING" && MISSING_STATES.has(item.state)) ||
          (tab === "NOT_MATCHED" && item.state === "NOT_MATCHED") ||
          (tab === "FOUND" && item.state === "FOUND") ||
          (tab === "NO_INVOICE_NEEDED" &&
            NO_INVOICE_NEEDED_TILE.has(item.state))) &&
        (!query.category || item.category === query.category) &&
        (!query.accountId || item.accountId === query.accountId) &&
        (!q ||
          [
            item.partner ?? "",
            item.narrative,
            item.amount,
            item.original?.amount ?? "",
          ]
            .join(" ")
            .toLowerCase()
            .includes(q)),
    );
    // a rendezés a LAPOZÁS ELŐTT, a szűrt teljes halmazon (missing-invoice-sort.ts)
    const sorted = sortMissingInvoiceItems(
      filtered,
      query.sort,
      query.direction,
    );
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const missingAccounts = this.missingStatementAccounts(computed, month);
    const count = (predicate: (state: ItemState) => boolean) =>
      all.filter((item) => predicate(item.state)).length;
    return {
      month,
      status: statusOf(
        missingAccounts.length,
        computed.accounts.length,
        count((s) => MISSING_STATES.has(s)),
      ),
      accounts: computed.accounts.map((account) => ({
        ...account,
        hasStatement: computed.coverage.has(`${account.id}:${month}`),
      })),
      tiles: {
        found: count((s) => s === "FOUND"),
        originalMissing: count((s) => s === "ORIGINAL_MISSING"),
        notMatched: count((s) => s === "NOT_MATCHED"),
        noInvoice: count((s) => NO_INVOICE_TILE.has(s)),
        noInvoiceNeeded: count((s) => NO_INVOICE_NEEDED_TILE.has(s)),
      },
      items: sorted
        .slice((page - 1) * pageSize, page * pageSize)
        .map(({ month: _month, accountId: _accountId, ...item }) => item),
      pagination: {
        page,
        pageSize,
        totalItems: filtered.length,
        totalPages: Math.ceil(filtered.length / pageSize),
      },
    };
  }

  /**
   * MIÉRT (NEM) JELÖLT EGY DOKUMENTUM EGY TERHELÉSNÉL (task os-hianyzo-szamlak-unpaid, niceshops: a tárolt számla nem jelent
   * meg a drawerben). Csak olvas; ugyanazokat a függvényeket hívja, mint a párosítás (`inWindow`, `samePartner`, `amountGap`).
   */
  async candidateDiagnosis(
    debitId: string,
    documentId: string,
  ): Promise<MissingInvoiceCandidateDiagnosis> {
    const computed = await this.compute();
    const classified = computed.classified.find((c) => c.debit.id === debitId);
    if (!classified)
      throw new NotFoundException("A banki terhelés nem található.");
    const findLoaded = (id: string) =>
      computed.documents.find((d) => d.id === id || d.aliasIds?.includes(id));
    let lookedUp = documentId;
    let document = findLoaded(documentId);
    let viaBillingRow = false;
    if (!document) {
      /*
        AZ AZONOSÍTÓ NEM MINDIG TÁROLT DOKUMENTUM (niceshops, 2026-11-12): a csomagellenőrzés `unpaid` listájának `id`-ja a
        bejövő számla SORÁNAK azonosítója, a sor `sourceDocumentId` mezője mutat a dokumentumra. Egy sor-azonosítóra a
        `loaded: false` nem a betöltésről szólt, hanem arról, hogy másik azonosító-teret kérdeztek. Ezért előbb megmérjük,
        milyen azonosítót kaptunk, és a sorét feloldjuk.
      */
      const kind = await this.repository.idKind(documentId);
      if (kind.kind === "billingRow" && kind.sourceDocumentId) {
        viaBillingRow = true;
        lookedUp = kind.sourceDocumentId;
        document = findLoaded(lookedUp);
      }
      if (!document)
        return {
          loaded: false,
          viaAlias: false,
          viaBillingRow,
          reason:
            kind.kind === "unknown"
              ? "NO_SUCH_ID"
              : kind.kind === "billingRow" && !kind.sourceDocumentId
                ? "BILLING_ROW_WITHOUT_SOURCE_DOCUMENT"
                : "DOCUMENT_NOT_LOADED",
          // a pontos ok: melyik betöltő-feltétel (vagy a lekérdezés szűrője) zárta ki; csak tárolt dokumentumnál van értelme
          loaderReason:
            kind.kind === "unknown" ||
            (kind.kind === "billingRow" && !kind.sourceDocumentId)
              ? null
              : await this.loaderReasonOf(lookedUp, computed.months),
          document: null,
          checks: null,
        };
    }
    const debit = {
      id: classified.debit.id,
      bookingDate: classified.debit.bookingDate.toISOString().slice(0, 10),
      amount: classified.debit.amount,
      currency: classified.debit.currency,
      original: classified.original,
      counterpartyName: classified.debit.counterpartyName,
      counterpartyAccount: normalizeAccount(
        classified.debit.counterpartyAccount,
      ),
      narrative: classified.debit.narrative,
      category: classified.classification.category,
    };
    const gap = amountGap(debit, document.gross, document.currency);
    const pairedWith = [...computed.outcomes]
      .filter(
        ([otherId, outcome]) =>
          otherId !== debitId &&
          outcome.documents.some((d) => d.id === document.id),
      )
      .map(([otherId]) => otherId);
    return {
      loaded: true,
      viaAlias: document.id !== lookedUp,
      viaBillingRow,
      reason: null,
      loaderReason: null,
      document: {
        documentId: document.id,
        number: shownNumber(document),
        source: document.source,
        date: document.date,
        gross:
          document.gross === null
            ? null
            : document.gross.toFixed(document.currency === "HUF" ? 0 : 2),
        currency: document.currency,
        supplierName: document.supplierName,
        kind: document.kind,
        // a párosítás azonosságai (`sha:` fájl-lenyomat, `inv:` számlaszám-kulcs) és az összevont társak: a kettős fizetés
        // jelzés pontosan ezek közös elemén áll, és a memóriában számolódnak (nincs róluk DB-oszlop)
        identities: [...(document.identities ?? [])].sort(),
        aliasIds: [...(document.aliasIds ?? [])].sort(),
        // az összevont jelölt tagjai tartalom-lenyomattal (tartalom és fájlnév nélkül): melyik tag hozta a közös lenyomatot
        members: (
          await this.repository.documentHashes(
            [
              ...new Set([
                document.id,
                ...(document.aliasIds ?? []),
                ...(document.originalId ? [document.originalId] : []),
              ]),
            ].sort(),
          )
        ).sort((a, b) => a.id.localeCompare(b.id)),
      },
      checks: {
        inWindow: inWindow(debit.bookingDate, document.date),
        nameMatches:
          !!debit.counterpartyName &&
          samePartner(
            document.supplierName,
            debit.counterpartyName,
            CANDIDATE_NAME_THRESHOLD,
          ),
        currencyComparable: gap !== null,
        amountExact: exact(gap, document.currency),
        grossKnown: document.gross !== null,
        isInvoice: document.kind === "INVOICE",
        pairedWith,
      },
    };
  }

  async item(id: string): Promise<MissingInvoiceItemDetail> {
    const computed = await this.compute();
    const found = computed.items.find((item) => item.id === id);
    if (!found) throw new NotFoundException("A banki terhelés nem található.");
    const { month: _month, accountId: _accountId, ...item } = found;
    const outcome = computed.outcomes.get(id);
    return {
      ...item,
      candidates: [
        ...(outcome?.candidates ?? []).map((d) => ({ d, amountOnly: false })),
        ...(outcome?.amountCandidates ?? []).map((d) => ({
          d,
          amountOnly: true,
        })),
      ].map(({ d, amountOnly }) => ({
        documentId: d.id,
        number: shownNumber(d),
        date: d.date,
        gross:
          d.gross === null
            ? null
            : d.gross.toFixed(d.currency === "HUF" ? 0 : 2),
        currency: d.currency,
        source: d.source,
        payee: d.payee,
        hasOriginal: d.hasOriginal,
        // a név nem egyezik, csak az összeg: a felület jelölheti, a választás kézi
        ...(amountOnly ? { amountOnly: true } : {}),
      })),
      payeeDocuments: (outcome?.documents ?? [])
        .filter((d) => d.payee === "UNKNOWN" || d.payeeMarked)
        .map((d) => ({
          documentId: d.id,
          number: shownNumber(d),
          payee: d.payee,
          marked: d.payeeMarked === true,
        })),
      // biztosításnál díjértesítő kell, nem számla-kérés (barracuda, 2. csoport)
      action:
        item.state === "NO_INVOICE" && item.category === "INSURANCE"
          ? "PROVIDE_PREMIUM_NOTICE"
          : ACTION[item.state],
      driveFolderUrl: httpsOrNull(
        this.environment.MISSING_INVOICES_DRIVE_FOLDER_URL,
      ),
      manualDocuments: (await this.repository.manualMatchRows(id)).map(
        (row) => {
          const shown = computed.documents.find(
            (d) =>
              d.id === row.documentId || d.aliasIds?.includes(row.documentId),
          );
          return {
            documentId: row.documentId,
            documentSource: row.documentSource,
            number: shown ? shownNumber(shown) : "",
            fileName: row.fileName,
            pairedAt: row.createdAt.toISOString(),
          };
        },
      ),
      doublePaidWith: (outcome?.doublePaidWith ?? []).flatMap((other) => {
        const debit = computed.items.find(
          (candidate) => candidate.id === other,
        );
        return debit
          ? [
              {
                id: debit.id,
                bookingDate: debit.bookingDate,
                amount: debit.amount,
                currency: debit.currency,
              },
            ]
          : [];
      }),
    };
  }

  /**
   * A JEV-JAVASLAT A DRAWERHEZ: melyik jelölt a számla. Csak javaslat; az ember a
   * mai kézi párosítással fogadja el. Kikapcsolva, nem mért tételnél vagy bármi
   * hibánál `documentId: null`, és a drawer úgy halad, mint javaslat nélkül.
   */
  /**
   * A SZÁMLÁZÁS „BEJÖVŐ SZÁMLÁK” NÉZETÉNEK (acrobot 25869): melyik
   * forrás-dokumentum melyik terheléshez párosodott, a meglévő számításból, ÚJ
   * LOGIKA NÉLKÜL. A kulcs a dokumentum azonosítója ÉS minden aliasa (egy
   * összevont NAV-sor mögött álló továbbított számla is megtalálja a magáét),
   * mellette a dokumentum vevő-ítélete és fajtája (a „nem párosítandó”-hoz).
   */
  async documentPairings(): Promise<Map<string, DocumentPairing>> {
    const computed = await this.compute();
    const result = new Map<string, DocumentPairing>();
    const entry = (document: CandidateDocument) => {
      const ids = [document.id, ...(document.aliasIds ?? [])];
      const found = ids.map((id) => result.get(id)).find(Boolean);
      const pairing: DocumentPairing = found ?? {
        payee: document.payee,
        kind: document.kind,
        debits: [],
        paidInFull: false,
        paperOriginal: false,
        document,
      };
      for (const id of ids) result.set(id, pairing);
      return pairing;
    };
    for (const document of computed.documents) entry(document);
    for (const item of computed.items) {
      const outcome = computed.outcomes.get(item.id);
      const inFull =
        (outcome?.state === "FOUND" || outcome?.state === "ORIGINAL_MISSING") &&
        !outcome.amountDifference;
      for (const document of outcome?.documents ?? []) {
        const pairing = entry(document);
        pairing.paidInFull =
          (pairing.debits.length === 0 || pairing.paidInFull) && inFull;
        pairing.paperOriginal = pairing.paperOriginal || item.paperOriginal;
        pairing.debits.push({
          bookingDate: item.bookingDate,
          amount: item.amount,
          currency: item.currency,
          original: item.original,
        });
      }
    }
    // a bejövő számla sora szám ÉS szállító szerint is megtalálja
    // (paperOriginalOfRow); ha egy kulcshoz két párosítás tartozik, a JELÖLT nyer
    // (a csomag is minden jelöltet beír, a két felület nem mondhat mást)
    for (const pairing of new Set(result.values())) {
      const numberKeys = pairing.document.number
        ? pairingNumberKeys(
            pairing.document.number,
            pairing.document.supplierName,
            pairing.document.supplierTaxNumber,
          )
        : [];
      // a számla AZONOSSÁGA (`inv:`, számlaszám + adószám-számjegyek) is kulcs: a bejövő számla sora, ami más
      // entitás ugyanazzal a számlával (niceshops), így is megtalálja a párosított dokumentumot
      const identities = (pairing.document.identities ?? []).filter(
        (identity) => identity.startsWith("inv:"),
      );
      for (const numberKey of [...numberKeys, ...identities]) {
        const existing = result.get(numberKey);
        if (!existing || (pairing.paperOriginal && !existing.paperOriginal))
          result.set(numberKey, pairing);
      }
    }
    return result;
  }

  async jevSuggestion(id: string): Promise<PairSuggestion> {
    if (!this.jev?.enabled())
      return { enabled: false, documentId: null, confidence: null };
    const computed = await this.compute();
    const row = computed.classified.find((c) => c.debit.id === id);
    if (!row) throw new NotFoundException("A banki terhelés nem található.");
    const outcome = computed.outcomes.get(id);
    const input = outcome
      ? jevPairInput(
          {
            id,
            bookingDate: row.debit.bookingDate.toISOString().slice(0, 10),
            amount: row.debit.amount,
            currency: row.debit.currency,
            original: row.original,
            counterpartyName: row.debit.counterpartyName,
            narrative: row.debit.narrative,
            category: row.classification.category,
          },
          outcome,
          freeDocuments(computed.documents, computed.outcomes),
        )
      : null;
    if (!input) return { enabled: true, documentId: null, confidence: null };
    return this.jev.suggest({
      bankTransactionId: id,
      // a mért szöveg mezői: a nyers terhelés, nem a megjelenítésre kerekített
      payment: {
        date: row.debit.bookingDate.toISOString().slice(0, 10),
        amount: row.debit.amount.toString(),
        currency: row.debit.currency,
        original: row.original
          ? `${row.original.amount.toString()} ${row.original.currency}`
          : "",
        partner: row.debit.counterpartyName ?? "",
        narrative: row.debit.narrative,
        type: row.debit.transactionType ?? "",
      },
      candidates: input.candidates,
      kinds: input.kinds,
    });
  }

  /**
   * KÉZI PÁROSÍTÁS (brief 12): a dokumentum a jelöltek bármelyike lehet (egy
   * összevont számla bármelyik azonosítójával), és egy dokumentum csak egy
   * terheléshez párosítható kézzel.
   */
  async pair(
    id: string,
    documentId: string,
    user: AuthenticatedUser,
  ): Promise<MissingInvoiceItemDetail> {
    const computed = await this.compute();
    if (!computed.items.some((item) => item.id === id))
      throw new NotFoundException("A banki terhelés nem található.");
    const document = computed.documents.find(
      (d) => d.id === documentId || d.aliasIds?.includes(documentId),
    );
    if (!document)
      throw new BadRequestException("Ilyen számla nincs a jelöltek között.");
    try {
      await this.repository.pair({
        bankTransactionId: id,
        documentId: document.id,
        documentSource: document.source,
        userId: user.id,
      });
    } catch (error) {
      if (isPrismaUniqueConstraintViolation(error, "documentSource"))
        throw new ConflictException(
          "Ezt a számlát már egy másik terheléshez párosították kézzel.",
        );
      throw error;
    }
    // a Jev-javaslat feloldása; soha nem dob, a párosítás már megtörtént
    await this.jev?.resolveOnPair({
      bankTransactionId: id,
      documentId: document.id,
    });
    return this.item(id);
  }

  /**
   * EGY FÁJL LEVÉTELE A SORRÓL (Niceshops, acrobot 48739): egy rossz terheléshez feltöltött fájl kézi párosítása megszűnik,
   * a terhelés többi párosítása marad. Csak egy MEGLÉVŐ kézi párosítás vehető le: egy szabály szerinti nem (azt a szabály
   * adja), egy nem ide tartozó dokumentum pedig 404.
   */
  async unpairOne(
    id: string,
    documentId: string,
    user: AuthenticatedUser,
  ): Promise<MissingInvoiceItemDetail> {
    const removed = await this.repository.unpairOne(id, user.id, documentId);
    if (removed === 0)
      throw new NotFoundException(
        "Ez a dokumentum nincs kézzel ehhez a terheléshez párosítva.",
      );
    return this.item(id);
  }

  async unpair(
    id: string,
    user: AuthenticatedUser,
  ): Promise<MissingInvoiceItemDetail> {
    const manual = (await this.repository.manualMatches()).get(id) ?? [];
    if (manual.length > 0) await this.repository.unpair(id, user.id, manual);
    return this.item(id);
  }

  async comment(
    id: string,
    comment: string | null,
    user: AuthenticatedUser,
  ): Promise<MissingInvoiceItemDetail> {
    const text = comment?.trim() || null;
    await this.repository.annotate(
      id,
      user.id,
      "missing-invoices.commented",
      { comment: text },
      { comment: text },
    );
    return this.item(id);
  }

  async recategorize(
    id: string,
    category: string | null,
    user: AuthenticatedUser,
  ): Promise<MissingInvoiceItemDetail> {
    await this.repository.annotate(
      id,
      user.id,
      "missing-invoices.recategorized",
      { categoryOverride: category },
      { category },
    );
    return this.item(id);
  }

  async paperOriginal(
    id: string,
    marked: boolean,
    user: AuthenticatedUser,
  ): Promise<MissingInvoiceItemDetail> {
    await this.repository.annotate(
      id,
      user.id,
      marked
        ? "missing-invoices.paper-original-marked"
        : "missing-invoices.paper-original-cleared",
      marked
        ? { paperOriginalAt: new Date(), paperOriginalByUserId: user.id }
        : { paperOriginalAt: null, paperOriginalByUserId: null },
      { marked },
    );
    return this.item(id);
  }

  /**
   * DUPLIKÁTUM-JELÖLÉS (task bank-dupla-import, Balázs 2026-10-30): a kezelő egy sort az ugyanazon fizetés második
   * példányának jelöl (az import dupla tétele). A jelölt sor kiesik a hiányzók és az összegzések közül, a sor MARAD
   * (az import a kulcsait látja, ezért egy újrafeltöltés nem hozza vissza), és a jelölés visszavonható. Ahol a sor
   * dokumentumhoz van párosítva, 409: előbb a párosítást kell visszavonni (különben a dokumentum árván maradna).
   * Ismételt azonos kérés semmit nem változtat; minden változás auditnaplót hagy.
   */
  async markDuplicate(
    id: string,
    marked: boolean,
    duplicateOfId: string | null | undefined,
    user: AuthenticatedUser,
  ): Promise<MissingInvoiceDuplicateResult> {
    const row = await this.repository.bankTransactionForDuplicate(id);
    if (!row) throw new NotFoundException("A banki tétel nem található.");
    const is = row.duplicateMarkedAt !== null;
    if (is === marked) return { id, duplicate: marked };
    if (marked) {
      if (row._count.matches > 0)
        throw new ConflictException(
          "A tétel számlához van párosítva: előbb vedd vissza a párosítást, utána jelölhető duplikátumnak.",
        );
      if (duplicateOfId) {
        if (duplicateOfId === id)
          throw new BadRequestException("A tétel nem lehet a saját párja.");
        if (!(await this.repository.bankTransactionForDuplicate(duplicateOfId)))
          throw new BadRequestException("A megadott pár-tétel nem található.");
      }
    }
    await this.repository.annotate(
      id,
      user.id,
      marked
        ? "missing-invoices.duplicate-marked"
        : "missing-invoices.duplicate-cleared",
      marked
        ? {
            duplicateMarkedAt: new Date(),
            duplicateMarkedByUserId: user.id,
            duplicateOfId: duplicateOfId ?? null,
          }
        : {
            duplicateMarkedAt: null,
            duplicateMarkedByUserId: null,
            duplicateOfId: null,
          },
      { marked, duplicateOfId: marked ? (duplicateOfId ?? null) : null },
    );
    return { id, duplicate: marked };
  }

  /** A duplikátumnak jelölt sorok (egy hónapban, ha megadott): a visszavonáshoz. */
  async duplicates(
    month: string | null,
  ): Promise<MissingInvoiceDuplicatesResponse> {
    if (month !== null && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
      throw new BadRequestException("A hónap alakja ÉÉÉÉ-HH.");
    const rows = await this.repository.duplicates(month);
    return {
      items: rows.map((row) => ({
        id: row.id,
        bookingDate: row.bookingDate.toISOString().slice(0, 10),
        amount: row.amount.toFixed(row.currency === "HUF" ? 0 : 2),
        currency: row.currency,
        partner: row.counterpartyName,
        narrative: row.narrative,
        markedAt: row.duplicateMarkedAt!.toISOString(),
        duplicateOfId: row.duplicateOfId,
      })),
    };
  }

  /**
   * A VEVŐ KÉZI JELÖLÉSE (acrobot 25633, Balázs éles esete: a beszkennelt
   * Sopro-számla vevője UNKNOWN, a tétel örökre Nem párosodott maradt, mert a
   * jelölendő állapot megvolt, a jelölés nem). Csak a terheléshez párosított,
   * nem ellenőrizhető (vagy már kézzel jelölt) vevőjű számlán; a NAV-ból vagy a
   * szövegből olvasott vevő nem írható így felül.
   */
  async markPayee(
    id: string,
    documentId: string,
    payee: "COMPANY" | "NOT_COMPANY",
    user: AuthenticatedUser,
  ): Promise<MissingInvoiceItemDetail> {
    const computed = await this.compute();
    if (!computed.items.some((item) => item.id === id))
      throw new NotFoundException("A banki terhelés nem található.");
    const document = (computed.outcomes.get(id)?.documents ?? []).find(
      (d) => d.id === documentId || d.aliasIds?.includes(documentId),
    );
    if (!document)
      throw new BadRequestException(
        "A számla nincs ehhez a terheléshez párosítva.",
      );
    const refused = new ConflictException(
      "A vevő a számla szövegéből vagy a NAV-ból ismert, kézzel nem írható felül.",
    );
    if (document.payee !== "UNKNOWN" && !document.payeeMarked) throw refused;
    const written = await this.repository.markPayee({
      documentIds: [document.id, ...(document.aliasIds ?? [])],
      payee,
      userId: user.id,
      bankTransactionId: id,
    });
    if (written === 0) throw refused;
    return this.item(id);
  }

  /**
   * SZÁMLA VAGY DÍJÉRTESÍTŐ FELTÖLTÉSE A DRAWERBŐL (brief 11, acrobot 25265 c
   * és 25274): csak PDF. A meglévő beszállítói olvasó próbálja kiolvasni (szám,
   * dátum, szállító); ha nem ismeri fel, a fájl akkor is tárolódik és párosul,
   * csak adat nélkül. A vevőt a szövegéből ellenőrizzük, mint a postafióknál.
   */
  async upload(
    id: string,
    file: { originalname: string; buffer: Buffer },
    kind: "INVOICE" | "PREMIUM_NOTICE",
    user: AuthenticatedUser,
  ): Promise<MissingInvoiceItemDetail> {
    const computed = await this.compute();
    const debit = computed.items.find((item) => item.id === id);
    if (!debit) throw new NotFoundException("A banki terhelés nem található.");
    if (!file.buffer.subarray(0, 5).equals(Buffer.from("%PDF-")))
      throw new BadRequestException("Csak PDF tölthető fel.");
    let importResult: SupplierInvoiceImportResult | null = null;
    try {
      importResult = await this.reader.read(new Uint8Array(file.buffer), {
        allowProforma: true,
      });
    } catch {
      this.logger.log(
        `A feltöltött ${file.originalname} beszállítói formátuma ismeretlen; adat nélkül tárolva.`,
      );
    }
    /*
      A SZÖVEG NÉLKÜLI PDF IS TÁROLÓDIK (kártya 847bca33, acrobot 34446): a fenti
      ígéret szerint a fel nem ismert fájl adat nélkül is párosul. Eddig a
      szövegkinyerés kivétele 400-zal elutasította a feltöltést, és nem maradt
      utána sor; élesben egy tömörített PDF (kompress.pdf) így nem került be.
      Most olvasatlan: szám és olvasat nélkül, a vevője ismeretlen.
    */
    let lines: string[] = [];
    try {
      lines = await pdfTextLines(new Uint8Array(file.buffer));
    } catch {
      this.logger.warn(
        `A feltöltött ${file.originalname} szövege nem olvasható; olvasatlanként tárolva.`,
      );
    }
    const text = lines.join("\n");
    /*
      AZ ÁLTALÁNOS OLVASÓ IS LEFUT, ha a szállítói minta nem ismerte fel
      (barracuda mérése, 2026-10-05: élesben 19 feltöltésből 19 olvasatlan
      maradt, mert csak a minta-olvasón ment át). Ugyanaz az út, mint a
      postafiók begyűjtésénél: előbb a szállító adószáma, utána a NAV-számai
      alapján a számlaszám. A jelölt-összerakó ebből vonja össze a feltöltést a
      NAV- vagy Számlázz.hu-sorral.
    */
    let textReading: InvoiceTextReading | null = null;
    /*
      A BEGYŰJTÉS TÖBBI LÉPÉSE IS (kártya 847bca33, 2026-10-21): az ismert
      számok, a SAJÁT terhelés közleményéből a banki hivatkozás, és a címkés
      végösszeg. Élesben egy francia szállító (Amblard) számlája a levélből
      F2602896 számmal jött be, ugyanez a feltöltésből szám nélkül, ezért a két
      példány soha nem vonódott össze. A lánc a `readUploadText`-ben áll, mert a
      tárolt feltöltések újraolvasása is azt futtatja (acrobot 34581).
    */
    if (!importResult && lines.length > 0)
      textReading = await readUploadText(
        lines,
        { fileName: file.originalname },
        [debit.narrative],
        this.repository,
      );
    const documentId = await this.repository.uploadAndPair({
      bankTransactionId: id,
      fileName: file.originalname,
      content: file.buffer,
      sha256: createHash("sha256").update(file.buffer).digest("hex"),
      kind,
      importResult,
      textReading,
      payee: payeeFromText(text),
      userId: user.id,
    });
    // a Jev-javaslat feloldása, mint a jelölt kiválasztásánál: a feltöltés azt
    // jelenti, hogy egyik jelölt sem volt a jó (acrobot 25880); soha nem dob
    await this.jev?.resolveOnPair({ bankTransactionId: id, documentId });
    return this.item(id);
  }

  /**
   * A HIÁNYLISTA (brief 13. pont): a hónap Hiányzik fülének minden tétele,
   * lapozás nélkül. A számla száma a párosítotté (a hibás számláé is, például a
   * díjbekérőé), ha nincs ilyen, a jelölteké.
   */
  async missingXlsx(
    month: string,
  ): Promise<{ fileName: string; content: Buffer }> {
    const computed = await this.compute();
    const rows = computed.items
      .filter((item) => item.month === month && MISSING_STATES.has(item.state))
      .map((item) => {
        const outcome = computed.outcomes.get(item.id);
        const documents = outcome?.documents.length
          ? outcome.documents
          : (outcome?.candidates ?? []);
        return {
          item,
          invoiceNumbers: documents.map((d) => d.number).filter(Boolean),
        };
      });
    return {
      fileName: `hianyzo-szamlak-${month}.xlsx`,
      content: await buildMissingInvoicesXlsx(month, rows),
    };
  }

  /**
   * A KÖNYVELŐI CSOMAG: a hónap MINDEN bejövő számlája a SZÁMLA KELTE
   * szerint, kifizetve vagy sem (Balázs, 2026-11-02 20:12 UTC; eddig a banki
   * terhelések hónapja döntött, tehát egy még ki nem fizetett számla nem
   * szerepelt; 2026-11-04 07:11 UTC óta nem a teljesítés napja, hanem a kelte
   * dönt). Egy számla egyszer, egy hónapban van benne: a szeptemberben kelt
   * számla, amit októberben fizettek, CSAK a szeptemberi csomagban áll.
   *
   * KÉT FORRÁSBÓL ÁLL:
   *  1. a bejövő számlák sorai (nem sztornózott, nem „nem könyvelendő”), a
   *     PDF-jük bármely útról (feed, kézi csatolás, begyűjtés); ha nincs, a
   *     borító „PDF hiányzik”-ot ír a számmal, a szállítóval, az összeggel;
   *  2. a banki oldalról azt, amit a sorok nem hoznak: a sztornózott vásárlás
   *     (az eredeti számla ÉS a jóváíró együtt, a terhelés hónapjában, mint
   *     eddig, acrobot 25981) és a csak postafiókból (vagy NAV-ból,
   *     elszámolásból) ismert, kifizetett számla, a SAJÁT keltének hónapjában.
   *
   * A papíron meglévő számla PDF-je kimarad, a borító „papíron megvan”-t ír
   * (#2000): a jelölés a számla párosított terhelésén áll.
   */
  async accountantPackage(
    month: string,
  ): Promise<{ fileName: string; content: Buffer }> {
    const { entries } = await this.packageSelection(month, (ids) =>
      this.repository.originals(ids),
    );
    const { pdf } = await buildAccountantPackage({
      month,
      company: {
        name: ACROPORA_COMPANY.name,
        taxNumber: ACROPORA_COMPANY.taxNumberBase,
      },
      entries,
    });
    return { fileName: `konyveloi-csomag-${month}.pdf`, content: pdf };
  }

  /**
   * A HÓNAP LAPJÁNAK CSOMAGELLENŐRZÉSE: ugyanaz a tételválasztás és ugyanaz a
   * számla-döntés (`headOutcome`), mint a csomag PDF-jében, de a fájloknak csak
   * az első öt bájtját olvassa. A nem olvasható PDF (pdf-lib) ezért itt nem
   * látszik: azt csak a csomag építése deríti ki.
   */
  async packageCheck(month: string): Promise<MissingInvoicePackageCheck> {
    const { entries } = await this.packageSelection(month, (ids) =>
      this.repository.originalHeads(ids),
    );
    const worst = (
      entry: (typeof entries)[number],
    ): MissingInvoicePackagePdf => {
      const outcomes = headOutcomes(entry);
      // Üres lista: egy tételnek nincs számlája és nincs papíron jelölve. Ilyen
      // tétel a csomagba nem kerül (a FOUND állapot dokumentumot vagy a papíron
      // jelölést jelenti), és a borító sem ír ki róla számlasort, tehát a lap
      // és a borító ugyanazt mondja: nincs mit hiányolni (barracuda, #2014).
      return (
        PACKAGE_PDF_ORDER.find((candidate) => outcomes.includes(candidate)) ??
        "ATTACHED"
      );
    };
    const items = entries.flatMap((entry) =>
      entry.itemIds.map((id) => ({
        id,
        pdf: worst(entry),
        attach: entry.source,
      })),
    );
    const unpaid = entries
      .filter((entry) => entry.source.kind === "ROW" && !entry.paid)
      .map((entry) => ({
        id: entry.source.id,
        number: entry.documents[0]?.number ?? "",
        supplier: entry.partner,
        amount: entry.amount,
        currency: entry.currency,
        date: entry.bookingDate,
        pdf: worst(entry),
      }));
    return {
      month,
      lackingCount: entries.filter((entry) =>
        MISSING_INVOICE_PACKAGE_PDF_LACKING.has(worst(entry)),
      ).length,
      items,
      unpaid,
    };
  }

  /**
   * A CSOMAG TÉTELEI: az egyetlen hely, ahol eldől, mi tartozik a hónap
   * csomagjába. A csomag PDF-je a teljes fájlokkal, a lap az első öt bájttal
   * hívja (`readFiles`); a tételek azonosak, mert ugyanaz a kód állítja elő.
   * Minden tétel megmondja, honnan jön (`source`: számla sora vagy banki
   * terhelés), kifizetett-e, és mely Megvan terhelések tartoznak hozzá.
   */
  private async packageSelection(
    month: string,
    readFiles: (
      ids: readonly string[],
    ) => Promise<Map<string, { fileName: string; content: Uint8Array }>>,
  ) {
    const [computed, billing, deduction] = await Promise.all([
      this.compute(),
      this.repository.packageBillingRows(month),
      this.repository.settledByDeduction(),
    ]);
    // az olvasat a fő azonosítón áll, de egy összevont jelöltnél az alias vagy
    // az eredeti is hordozhatja (barracuda visszamérése)
    const idsOf = (document: CandidateDocument) => [
      document.id,
      ...(document.aliasIds ?? []),
      ...(document.originalId ? [document.originalId] : []),
    ];
    // A sorokat vevő szerint NEM szűrjük: a Számlázz.hu bejövő feed a cég saját
    // fiókjáé, a nem a cégre szóló számlát a „nem könyvelendő” jelölés zárja ki
    // (barracuda, #2002). Ha a feedben mégis más vevőre szóló sor jelenne meg,
    // ide vevő-szűrő kell (a buyerTaxNumber törzse). Mérve nem volt: a fleet_ro
    // a buyer-oszlopokat nem látja (2026-11-02).
    const inFeed = inFeedTest(billing.refs);
    const documentsOfItem = (id: string) =>
      computed.outcomes.get(id)?.documents ?? [];

    // 1. a sztornózott vásárlások: az eredeti és a jóváíró EGY sorban
    const refundItems = computed.items.filter(
      (item) => item.month === month && item.refund !== null,
    );
    // a sor kizárásához MINDEN hónap sztornózott vásárlása számít: az eredeti
    // számla kelte szeptember lehet, a visszatérítés terhelése október,
    // és a számla ilyenkor is csak a sztornózott vásárlás sorában szerepel
    // (barracuda kérdése, #2002)
    const inRefund = inFeedTest(
      computed.items
        .filter((item) => item.refund !== null)
        .flatMap((item) => documentsOfItem(item.id))
        .flatMap((document) =>
          idsOf(document).map((id) => ({
            sourceDocumentId: id,
            documentNumber: document.number,
          })),
        ),
    );
    // 2. a banki oldal többi Megvan-tétele: csak az a dokumentum, amit a
    // bejövő számla sorai nem hoznak, a saját keltének hónapjában
    const bankItems = computed.items.flatMap((item) => {
      if (item.state !== "FOUND" || item.refund !== null) return [];
      const all = documentsOfItem(item.id);
      const documents = all.filter((document) => !inFeed(document));
      // a számla nélküli, papíron meglévő tételnek nincs saját kelte: a
      // terhelés napja dönt; ha minden dokumentumát a sorok hozzák, kimarad
      if (all.length > 0 && documents.length === 0) return [];
      const date =
        documents.map((document) => document.date).sort()[0] ??
        item.bookingDate;
      return date.slice(0, 7) === month ? [{ item, documents }] : [];
    });

    const labelOf = (item: (typeof refundItems)[number]) =>
      `sztornózott vásárlás: az eredeti számla és a jóváíró együtt; ${
        item.refund!.receivedOn
          ? `a visszatérítés megjött (${item.refund!.receivedOn})`
          : item.state === "REFUND_MISSING"
            ? `a visszatérítés elmaradt (határidő: ${item.refund!.due})`
            : `a visszatérítés várható (határidő: ${item.refund!.due})`
      }`;
    /*
      A CSAK POSTAFIÓKBÓL ISMERT SZÁMLA (kártya e4c3b0fb, acrobot 27599): a PDF
      marad a csomagban, mint eddig, de a kinyert számok CSAK jóváhagyás után
      kerülnek a borítóra; addig a tétel „Ellenőrizendő”.
    */
    const bankDocuments = [
      ...refundItems.flatMap((item) => documentsOfItem(item.id)),
      ...bankItems.flatMap(({ documents }) => documents),
    ];
    const { feed, readings } = await this.repository.packageReadings(
      bankDocuments.flatMap(idsOf),
    );
    const mailboxOnly = notInFeedTest(feed);
    const dataNoteOf = (document: CandidateDocument) => {
      if (!mailboxOnly(document)) return {};
      const reading = idsOf(document)
        .map((id) => readings.get(id))
        .find(Boolean);
      return {
        dataNote: packageDataNote(
          reading
            ? { state: reading.state, values: storedValues(reading) }
            : null,
        ),
      };
    };
    const shown = (documents: readonly CandidateDocument[]) =>
      documents.map((document) => ({
        number: shownNumber(document),
        originalId:
          document.originalId ?? (document.hasOriginal ? document.id : null),
        issuer: document.supplierName,
        ...dataNoteOf(document),
      }));

    // a papíron megvan jelölés a párosított terhelésen áll (#2000); a bejövő
    // számla sora a feed dokumentumán keresztül találja meg
    // ugyanaz a döntés, mint a Bejövő számlák listán (`paperOriginalOfRow`): a
    // sor forrás-dokumentuma szerint, ennek hiányában a szám szerint
    const paperPairings = new Map<string, { paperOriginal: boolean }>();
    for (const item of computed.items.filter((i) => i.paperOriginal))
      for (const paperDocument of documentsOfItem(item.id)) {
        const numberKeys = paperDocument.number
          ? pairingNumberKeys(
              paperDocument.number,
              paperDocument.supplierName,
              paperDocument.supplierTaxNumber,
            )
          : [];
        for (const key of [...idsOf(paperDocument), ...numberKeys])
          if (key) paperPairings.set(key, { paperOriginal: true });
      }

    const bankEntries = [
      ...refundItems.map((item) => ({
        item,
        documents: shown(documentsOfItem(item.id)),
        label: labelOf(item) as string | undefined,
      })),
      ...bankItems.map(({ item, documents }) => ({
        item,
        documents: shown(documents),
        label: "banki terhelés napja" as string | undefined,
      })),
    ];

    // a bejövő számla sora, amit a jóváíró vagy az eredeti már hordoz, nem
    // kerül kétszer a csomagba
    const rows = billing.rows.filter(
      (row) =>
        !inRefund({
          id: row.sourceDocumentId ?? "",
          number: row.documentNumber,
        }),
    );
    const paperRow = (row: (typeof rows)[number]) =>
      paperOriginalOfRow(row, paperPairings);

    // a papíron megvan számla fájlját nem is kérjük le: nem kerül a csomagba
    const files = await readFiles([
      ...bankEntries
        .filter(({ item }) => !item.paperOriginal)
        .flatMap(({ documents }) =>
          documents.flatMap((d) => (d.originalId ? [d.originalId] : [])),
        ),
      ...rows.filter((row) => !paperRow(row)).flatMap((row) => row.pdfIds),
    ]);
    const isPdf = (id: string) => {
      const content = files.get(id)?.content;
      return (
        content !== undefined &&
        Buffer.from(content.subarray(0, 5)).toString("latin1") === "%PDF-"
      );
    };
    const fileOfRow = (row: (typeof rows)[number]) => {
      // az első PDF, ha egy sincs, az első fájl (a borító megmondja, mi baja)
      const id = row.pdfIds.find(isPdf) ?? row.pdfIds.find((i) => files.has(i));
      return (id && files.get(id)) || null;
    };
    const dayOf = (date: Date) => date.toISOString().slice(0, 10);
    const amountOf = (value: Prisma.Decimal, currency: string) =>
      value.toFixed(currency === "HUF" ? 0 : 2);

    // melyik Megvan terheléshez tartozik egy számla-dokumentum (a kifizetettség
    // és a lap sora innen jön)
    // (azonosító vagy szám szerint, mint a „papíron megvan” jelölésnél)
    const itemOfDocument = new Map<string, string>();
    /*
      A SZÁMLA AZONOSSÁGA IS KULCS (niceshops, 2026-11-12, acrobot): a terhelés egy FELTÖLTÖTT dokumentumhoz párosodott
      (`inv:r49010000026240667|63964918`), a bejövő számla-rekord más entitás ugyanazzal a számlaszámmal és
      adószámmal, és sem az azonosítója, sem a szám-kulcsa nem egyezik a feltöltött dokumentuméval (egy külföldi
      adószámból nincs adószámos párosítási kulcs: `supplierTaxBase` csak a magyar alakot adja, a név pedig
      eltérhet). Az összevonás azonossága (`inv:`) viszont számlaszám + adószám-számjegyek, és ugyanezt adja a
      bejövő számla sora: így a rekord fizetettnek látszik, akárhány entitásban áll a számla.
    */
    const itemOfIdentity = new Map<
      string,
      { itemId: string; gross: Prisma.Decimal | null; currency: string }[]
    >();
    /*
      A KÉTSZER FIZETETT TÉTEL IS PÁROSÍTOTT (task os-hianyzo-szamlak-unpaid, 2026-11-11, a Vízművek
      105300361726 októberi eset): a Kétszer fizetett állapot a terhelés felől „nem Megvan”, de a számla
      mindkét terheléshez párosítva van. Csak a FOUND-ot nézve a számla sora „kifizetetlen” maradt, miközben
      a terhelés-lista azt mondta, hogy kétszer is fizettük: két nézet ellentmondott egymásnak.
    */
    for (const item of computed.items)
      if (item.state === "FOUND" || item.state === "DOUBLE_PAID")
        for (const document of documentsOfItem(item.id)) {
          const numberKeys = document.number
            ? pairingNumberKeys(
                document.number,
                document.supplierName,
                document.supplierTaxNumber,
              )
            : [];
          for (const key of [...idsOf(document), ...numberKeys])
            if (key && !itemOfDocument.has(key))
              itemOfDocument.set(key, item.id);
          for (const identity of document.identities ?? [])
            if (identity.startsWith("inv:"))
              itemOfIdentity.set(identity, [
                ...(itemOfIdentity.get(identity) ?? []),
                {
                  itemId: item.id,
                  gross: document.gross,
                  currency: document.currency,
                },
              ]);
        }
    const itemOfRow = (row: {
      sourceDocumentId: string | null;
      documentNumber: string;
      supplierName: string;
      supplierTaxNumber: string | null;
      grossAmount: Prisma.Decimal;
      currency: string;
    }) => {
      const numberKeys = pairingNumberKeys(
        row.documentNumber,
        row.supplierName,
        row.supplierTaxNumber,
      );
      return (
        (row.sourceDocumentId
          ? itemOfDocument.get(row.sourceDocumentId)
          : undefined) ??
        numberKeys.map((key) => itemOfDocument.get(key)).find(Boolean) ??
        // az azonosság az összeget nem nézi: csak egyező bruttónál és devizánál fizetett (`sameGross`)
        itemOfIdentity
          .get(
            invoiceIdentity(
              row.documentNumber,
              row.supplierTaxNumber,
              row.supplierName,
            ),
          )
          ?.find((candidate) => sameGross(row, candidate))?.itemId
      );
    };

    const settledByDeduction = (row: (typeof rows)[number]) => {
      const base = (row.supplierTaxNumber ?? "").replace(/\D/g, "").slice(0, 8);
      const number = row.documentNumber.replace(/\s+/g, "").toUpperCase();
      return (
        (base === FOXPOST_TAX_BASE && deduction.foxpost.has(number)) ||
        (base === GLS_TAX_BASE && deduction.gls.has(number))
      );
    };

    const entries = [
      ...rows.map((row) => {
        const file = paperRow(row) ? null : fileOfRow(row);
        const itemId = itemOfRow(row);
        return {
          bookingDate: dayOf(row.issueDate),
          partner: row.supplierName,
          amount: amountOf(row.grossAmount, row.currency),
          currency: row.currency,
          paperOriginal: paperRow(row),
          label: "számla kelte",
          documents: [
            {
              number: row.documentNumber,
              file,
              ...(file || paperRow(row) ? {} : { missingPdf: true }),
            },
          ],
          source: { kind: "ROW" as const, id: row.id },
          // a nulla összegű számlát (Telekom, Pólus, október) terhelés nem fizethet, tehát nem „kifizetetlen”; és amit az utánvét-elszámolás
          // levon (Foxpost, GLS), azt sem bankból fizetik (settledByDeduction)
          paid:
            itemId !== undefined ||
            row.grossAmount.isZero() ||
            settledByDeduction(row),
          itemIds: itemId ? [itemId] : [],
        };
      }),
      ...bankEntries.map(({ item, label, documents }) => ({
        bookingDate: item.bookingDate,
        partner: item.partner ?? "",
        amount: item.amount,
        currency: item.currency,
        paperOriginal: item.paperOriginal,
        ...(label ? { label } : {}),
        documents: documents.map((d) => ({
          number: shownNumber(d),
          file: (d.originalId && files.get(d.originalId)) || null,
          ...(d.issuer ? { issuer: d.issuer } : {}),
          ...(d.dataNote ? { dataNote: d.dataNote } : {}),
        })),
        source: { kind: "BANK" as const, id: item.id },
        paid: true,
        itemIds: [item.id],
      })),
    ].sort((a, b) => a.bookingDate.localeCompare(b.bookingDate));
    return { entries };
  }

  private missingStatementAccounts(
    computed: Computed,
    month: string,
  ): string[] {
    return computed.accounts
      .filter((account) => !computed.coverage.has(`${account.id}:${month}`))
      .map((account) => account.name);
  }

  /**
   * MIÉRT NINCS BETÖLTVE EGY TÁROLT DOKUMENTUM: a betöltő kizárási kódja (`loaderExclusion`, „Nem könyvelendő” jelölés), vagy
   * a lekérdezés szűrője (emberi döntésre vár / nem jelölt fajta). A betöltést itt újra lefuttatjuk, ugyanazzal a kóddal,
   * csak a jelölt-vizsgálatnál (ritka, csak olvas); `null`, ha egyik sem magyarázza (a dokumentum átment a szűrőkön).
   */
  private async loaderReasonOf(
    id: string,
    months: readonly string[],
  ): Promise<{ code: string; detail: string | null } | null> {
    if (months.length === 0) return null;
    const window = candidateWindow(months[0]!, months[months.length - 1]!);
    const { excluded } = await this.repository.candidatesWithExclusions(
      window.from,
      window.to,
    );
    const excludedHere = excluded.get(id);
    if (excludedHere)
      return { code: excludedHere.code, detail: excludedHere.detail };
    const fields = await this.repository.queryFields(id);
    const byQuery = fields ? queryExclusion(fields) : null;
    return byQuery ? { code: byQuery.code, detail: byQuery.detail } : null;
  }

  private async compute(): Promise<Computed> {
    const [accountRows, debits, credits, coverage, manual, ownRows] =
      await Promise.all([
        this.repository.accounts(),
        this.repository.debits(),
        this.repository.credits(),
        this.repository.statementCoverage(),
        this.repository.manualMatches(),
        this.repository.ownOutgoingDocuments(),
      ]);
    const ownDocuments = ownRows.map((row) => ({
      number: row.documentNumber,
      kindCode: row.kindCode,
      customerName: row.customerName,
      gross: row.grossAmount,
      currency: row.currency,
      issueDate: dayOf(row.issueDate),
    }));
    const accounts = accountRows.map((account) => ({
      id: account.id,
      name: account.name ?? `${account.accountNumber} (${account.currency})`,
      accountNumber: account.accountNumber,
      currency: account.currency,
    }));
    if (debits.length === 0)
      return {
        items: [],
        months: [],
        accounts,
        coverage,
        outcomes: new Map(),
        documents: [],
        classified: [],
      };

    const first = monthOf(debits[0]!.bookingDate);
    const last = monthOf(debits[debits.length - 1]!.bookingDate);
    const months: string[] = [];
    for (let m = first; m <= last; m = shiftMonth(m, 1)) months.push(m);

    // 12 hónap vissza, nem 4: a számlaszám-szabálynak (1.) nincs dátumablaka,
    // csak annak, amit betöltünk; a többi szabály az `inWindow` 4 hónapján
    // belül marad. Mérve 2026-10-01, éles: a Hertlein 260835 április 29-én
    // kelt, szeptember 25-én fizettük, a közlemény megnevezi, és a 4 hónapos
    // betöltés kizárta. Decembertől minden dokumentumon mérve a bővítés
    // pontosan ezt az egy párt adja hozzá, hamisat egyet sem.
    const window = candidateWindow(first, last);
    const loaded = await this.repository.candidates(window.from, window.to);
    // minden forrás, aminek a vevője még nincs kiszámolva (payeeCheck NULL):
    // a postafiók lustán, és a cégnév-szabály előtti NOT_COMPANY sorok is,
    // amiket a 20261001000800 migráció visszaállított (acrobot 25640)
    await this.checkPayees(loaded.filter((d) => d.payee === "UNKNOWN"));

    const ownAccounts = new Set(
      accountRows.map((a) => normalizeAccount(a.accountNumber)),
    );
    const payrollNames = payrollNamesOf(debits);
    const classified = debits.map((debit) => {
      const byRule = classifyTransaction(debit, { ownAccounts, payrollNames });
      /*
        A VEVŐNEK VISSZAUTALT ÖSSZEG (kártya a116ec70): a közlemény saját számlaszámot nevez, és ugyanarra a vevőre azonos
        összegű sztornó áll. A besorolás magánszemélynél a számlaszám-mintából is tudja; cégnél csak ebből az adatból.
        Kártyás fizetés és a már besorolt „Nem kell számla” tétel kimarad; a kézi átsorolás úgyis fölötte áll.
      */
      const refund =
        !NO_INVOICE_CATEGORIES.has(byRule.category) &&
        !/KÁRTY/i.test(debit.transactionType ?? "")
          ? ownInvoiceRefund(
              {
                bookingDate: dayOf(debit.bookingDate),
                amount: debit.amount,
                currency: debit.currency,
                counterpartyName: debit.counterpartyName,
                narrative: debit.narrative,
              },
              ownDocuments,
            )
          : null;
      const ruled = refund
        ? {
            category: "CUSTOMER_REFUND" as BankCategory,
            rule: `a saját ${refund.cited} számlánk összegét utaltuk vissza a vevőnek, a sztornó: ${refund.credit.number}`,
          }
        : byRule;
      // a kézi átsorolás a szabály fölött áll; a szabály mondata megmarad
      const classification = debit.categoryOverride
        ? {
            category: debit.categoryOverride as BankCategory,
            rule: `kézzel átsorolva (a szabály szerint: ${ruled.rule})`,
          }
        : ruled;
      return {
        debit,
        classification,
        original: originalAmountOf(debit.narrative),
      };
    });
    const matchable = classified.map(({ debit, classification, original }) => ({
      id: debit.id,
      bookingDate: debit.bookingDate.toISOString().slice(0, 10),
      amount: debit.amount,
      currency: debit.currency,
      original,
      counterpartyName: debit.counterpartyName,
      counterpartyAccount: normalizeAccount(debit.counterpartyAccount),
      narrative: debit.narrative,
      category: classification.category,
    }));
    const match = (documents: CandidateDocument[]) =>
      matchMonth({
        debits: matchable,
        documents,
        manual,
        paperOriginals: new Set(
          debits.filter((d) => d.paperOriginalAt).map((d) => d.id),
        ),
        credits: credits.map((credit) => ({
          id: credit.id,
          bookingDate: dayOf(credit.bookingDate),
          amount: credit.amount,
          currency: credit.currency,
          counterpartyName: credit.counterpartyName,
          narrative: credit.narrative,
        })),
        // a kivonatok utolsó napja, nem a mai nap: egy még be nem töltött
        // kivonat nem jelent elmaradt visszatérítést
        asOf: [...debits, ...credits]
          .map((t) => dayOf(t.bookingDate))
          .reduce((a, b) => (a > b ? a : b)),
      });
    // a kézzel párosított, olvashatatlan feltöltés a számla sorával egy (7ff26bc9)
    const firstPass = mergeManualUploads(loaded, manual, matchable);
    let documents = firstPass;
    let outcomes = match(firstPass);
    /*
      A HAVI ISMÉTLŐDŐ SZÁMLA DÖNTŐJE (acrobot 26871) azt kérdezi, melyik sor
      van MÁR más terheléshez párosítva, és ezt csak egy párosítás után tudjuk.
      Ezért az első menet eredményével még egyszer összevonunk, és csak akkor
      párosítunk újra, ha ettől tényleg vonódott össze valami.
    */
    const elsewhere = new Map<string, string[]>();
    for (const [debitId, outcome] of outcomes)
      for (const document of outcome.documents)
        for (const id of [document.id, ...(document.aliasIds ?? [])])
          elsewhere.set(id, [...(elsewhere.get(id) ?? []), debitId]);
    const secondPass = mergeManualUploads(loaded, manual, matchable, elsewhere);
    if (secondPass.length !== firstPass.length) {
      documents = secondPass;
      outcomes = match(secondPass);
    }

    const accountName = new Map(accounts.map((a) => [a.id, a.name]));
    const items = classified.map(({ debit, classification, original }) => {
      const outcome = outcomes.get(debit.id) as MatchOutcome;
      const document = outcome.documents[0] ?? null;
      return {
        month: monthOf(debit.bookingDate),
        accountId: debit.bankAccountId,
        id: debit.id,
        bookingDate: debit.bookingDate.toISOString().slice(0, 10),
        account: {
          id: debit.bankAccountId,
          name: accountName.get(debit.bankAccountId) ?? "",
        },
        partner: debit.counterpartyName,
        narrative: debit.narrative,
        amount: debit.amount.toFixed(debit.currency === "HUF" ? 0 : 2),
        currency: debit.currency,
        original: original
          ? { amount: original.amount.toFixed(2), currency: original.currency }
          : null,
        category: classification.category,
        categoryRule: classification.rule,
        categoryOverridden: debit.categoryOverride !== null,
        state: outcome.state,
        document: document
          ? {
              id: document.id,
              number: shownNumber(document),
              source: document.source,
            }
          : null,
        matchedBy: outcome.matchedBy,
        documentNumbers: outcome.documents.map((d) => shownNumber(d)),
        missingNumbers: outcome.missingNumbers ?? [],
        amountDifference: outcome.amountDifference
          ? {
              amount: outcome.amountDifference.amount.toFixed(
                outcome.amountDifference.currency === "HUF" ? 0 : 2,
              ),
              currency: outcome.amountDifference.currency,
            }
          : null,
        refund: outcome.refund
          ? {
              amount: outcome.refund.amount.toFixed(
                outcome.refund.currency === "HUF" ? 0 : 2,
              ),
              currency: outcome.refund.currency,
              creditNoteNumber: outcome.refund.creditNoteNumber,
              due: outcome.refund.due,
              receivedOn: outcome.refund.receivedOn,
            }
          : null,
        comment: debit.comment,
        // a terhelésen álló jelölés, vagy a párosított számla soron álló jelölése
        paperOriginal:
          debit.paperOriginalAt !== null ||
          outcome.documents.some((d) => d.paperMarked === true),
        // csak a terhelésé: ez vonható vissza itt (a számláé a Bejövő számlákon)
        paperOriginalMarkedHere: debit.paperOriginalAt !== null,
      };
    });
    return {
      items,
      months,
      accounts,
      coverage,
      outcomes,
      documents,
      classified,
    };
  }

  /**
   * A dokumentum vevőjének ellenőrzése, egyszer: a szövegéből, és az
   * eredmény tárolódik. A PDF olvasása drága, ezért nem minden kérésnél.
   */
  private async checkPayees(documents: { id: string; payee: string }[]) {
    if (documents.length === 0) return;
    const rows = await this.repository.uncheckedMailboxContent(
      documents.map((d) => d.id),
    );
    for (const row of rows) {
      let text = "";
      try {
        text = row.fileName.toLowerCase().endsWith(".pdf")
          ? (await pdfTextLines(row.content)).join("\n")
          : new TextDecoder("utf-8").decode(row.content);
      } catch {
        this.logger.warn(`A(z) ${row.id} dokumentum szövege nem olvasható.`);
      }
      const payee = payeeFromText(text);
      await this.repository.setPayee(row.id, payee);
      const document = documents.find((d) => d.id === row.id);
      if (document) document.payee = payee;
    }
  }
}

function statusOf(
  missingStatementCount: number,
  accountCount: number,
  missingItems: number,
): MissingInvoiceMonthStatus {
  if (accountCount > 0 && missingStatementCount === accountCount)
    return "STATEMENT_MISSING";
  if (missingStatementCount > 0) return "STATEMENT_PARTIAL";
  return missingItems > 0 ? "INCOMPLETE" : "READY";
}

/** A „Mit kell tenni” kulcsa állapotonként. */
const ACTION: Record<ItemState, MissingInvoiceAction> = {
  FOUND: "NONE",
  ORIGINAL_MISSING: "PROVIDE_ORIGINAL",
  NOT_MATCHED: "PAIR_OR_UPLOAD",
  NO_INVOICE: "REQUEST_INVOICE",
  NOT_COMPANY: "REQUEST_REISSUE_TO_COMPANY",
  PROFORMA_ONLY: "REQUEST_FINAL_INVOICE",
  DOUBLE_PAID: "CHECK_DOUBLE_PAYMENT",
  NO_INVOICE_NEEDED: "NONE",
  REFUND_EXPECTED: "NONE",
  REFUND_MISSING: "CHASE_REFUND",
};

/** A Drive-mappa hivatkozása csak https alakban; fiktív link nem lehet (brief 11). */
function httpsOrNull(value: string | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  try {
    return new URL(text).protocol === "https:" ? text : null;
  } catch {
    return null;
  }
}
