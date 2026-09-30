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
  type MissingInvoiceItemDetail,
  type SupplierInvoiceImportResult,
  type MissingInvoiceItem,
  type MissingInvoiceMonth,
  type MissingInvoiceMonthDetail,
  type MissingInvoiceMonthQuery,
  type MissingInvoiceMonthsResponse,
  type MissingInvoiceMonthStatus,
} from "@acropora/types";

import { isPrismaUniqueConstraintViolation } from "../common/prisma-error.util.js";
import { createHash } from "node:crypto";

import { SupplierInvoiceImportService } from "../purchasing/supplier-invoice-import/supplier-invoice-import.service.js";
import { pdfTextLines } from "../purchasing/supplier-invoice-import/pdf-text-lines.js";
import {
  classifyTransaction,
  payrollNamesOf,
  type BankCategory,
} from "./bank-transaction.classify.js";
import {
  matchMonth,
  type CandidateDocument,
  type ItemState,
  type MatchOutcome,
} from "./missing-invoice-matching.js";
import {
  MissingInvoicesRepository,
  normalizeAccount,
} from "./missing-invoices.repository.js";
import { originalAmountOf } from "./otp-statement.parser.js";
import { payeeFromText } from "./payee-check.js";
import { buildAccountantPackage } from "./missing-invoices-package.pdf.js";
import { buildMissingInvoicesXlsx } from "./missing-invoices-xlsx.js";

/** A „Hiányzik” fül és a Hiányos hónap: minden, amihez teendő van. */
/** A környezet (a Drive-mappa hivatkozása); a teszt ezen át adja. */
export const MISSING_INVOICES_ENV = Symbol("MISSING_INVOICES_ENV");

const MISSING_STATES: ReadonlySet<ItemState> = new Set([
  "ORIGINAL_MISSING",
  "NOT_MATCHED",
  "NO_INVOICE",
  "NOT_COMPANY",
  "PROFORMA_ONLY",
]);
const NO_INVOICE_TILE: ReadonlySet<ItemState> = new Set([
  "NO_INVOICE",
  "NOT_COMPANY",
  "PROFORMA_ONLY",
]);

/** A tétel-lista lapmérete, ha a kérés nem ad (szerződés: 1..100, 25). */
const DEFAULT_PAGE_SIZE = 25;

const monthOf = (date: Date) => date.toISOString().slice(0, 7);

function shiftMonth(month: string, by: number): string {
  const total =
    Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + by;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

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
@Injectable()
export class MissingInvoicesService {
  private readonly logger = new Logger(MissingInvoicesService.name);

  constructor(
    private readonly repository: MissingInvoicesRepository,
    private readonly reader: SupplierInvoiceImportService,
    @Optional()
    @Inject(MISSING_INVOICES_ENV)
    private readonly environment: NodeJS.ProcessEnv = process.env,
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
          debitCount: items.filter((i) => i.state !== "NO_INVOICE_NEEDED")
            .length,
          found: count("FOUND"),
          originalMissing: count("ORIGINAL_MISSING"),
          notMatched: count("NOT_MATCHED"),
          noInvoice: count(NO_INVOICE_TILE),
          noInvoiceNeeded: count("NO_INVOICE_NEEDED"),
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
    const filtered = all.filter(
      (item) =>
        (tab === "ALL" ||
          (tab === "MISSING" && MISSING_STATES.has(item.state)) ||
          (tab === "NOT_MATCHED" && item.state === "NOT_MATCHED") ||
          (tab === "FOUND" && item.state === "FOUND") ||
          (tab === "NO_INVOICE_NEEDED" &&
            item.state === "NO_INVOICE_NEEDED")) &&
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
        noInvoiceNeeded: count((s) => s === "NO_INVOICE_NEEDED"),
      },
      items: filtered
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

  async item(id: string): Promise<MissingInvoiceItemDetail> {
    const computed = await this.compute();
    const found = computed.items.find((item) => item.id === id);
    if (!found) throw new NotFoundException("A banki terhelés nem található.");
    const { month: _month, accountId: _accountId, ...item } = found;
    const outcome = computed.outcomes.get(id);
    return {
      ...item,
      candidates: (outcome?.candidates ?? []).map((d) => ({
        documentId: d.id,
        number: d.number,
        date: d.date,
        gross:
          d.gross === null
            ? null
            : d.gross.toFixed(d.currency === "HUF" ? 0 : 2),
        currency: d.currency,
        source: d.source,
        payee: d.payee,
        hasOriginal: d.hasOriginal,
      })),
      action: ACTION[item.state],
      driveFolderUrl: httpsOrNull(
        this.environment.MISSING_INVOICES_DRIVE_FOLDER_URL,
      ),
    };
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
    if (!computed.items.some((item) => item.id === id))
      throw new NotFoundException("A banki terhelés nem található.");
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
    let text = "";
    try {
      text = (await pdfTextLines(new Uint8Array(file.buffer))).join("\n");
    } catch {
      throw new BadRequestException("A PDF nem olvasható.");
    }
    await this.repository.uploadAndPair({
      bankTransactionId: id,
      fileName: file.originalname,
      content: file.buffer,
      sha256: createHash("sha256").update(file.buffer).digest("hex"),
      kind,
      importResult,
      payee: payeeFromText(text),
      userId: user.id,
    });
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
   * A KÖNYVELŐI CSOMAG: a hónap Megvan-tételeinek eredetijei egy PDF-ben. A
   * díjbekérő, a nem a cégre szóló és a hiányzó nem Megvan, tehát nem is kerül
   * bele. Összevont számlánál a fájl az eredetit hordozó forrásé.
   */
  async accountantPackage(
    month: string,
  ): Promise<{ fileName: string; content: Buffer }> {
    const computed = await this.compute();
    const found = computed.items.filter(
      (item) => item.month === month && item.state === "FOUND",
    );
    const documentsOf = (id: string) =>
      (computed.outcomes.get(id)?.documents ?? []).map((document) => ({
        number: document.number,
        originalId:
          document.originalId ?? (document.hasOriginal ? document.id : null),
      }));
    const files = await this.repository.originals(
      found.flatMap((item) =>
        documentsOf(item.id).flatMap((d) =>
          d.originalId ? [d.originalId] : [],
        ),
      ),
    );
    const { pdf } = await buildAccountantPackage({
      month,
      company: {
        name: ACROPORA_COMPANY.name,
        taxNumber: ACROPORA_COMPANY.taxNumberBase,
      },
      entries: found.map((item) => ({
        bookingDate: item.bookingDate,
        partner: item.partner ?? "",
        amount: item.amount,
        currency: item.currency,
        paperOriginal: item.paperOriginal,
        documents: documentsOf(item.id).map((d) => ({
          number: d.number,
          file: (d.originalId && files.get(d.originalId)) || null,
        })),
      })),
    });
    return { fileName: `konyveloi-csomag-${month}.pdf`, content: pdf };
  }

  private missingStatementAccounts(
    computed: Computed,
    month: string,
  ): string[] {
    return computed.accounts
      .filter((account) => !computed.coverage.has(`${account.id}:${month}`))
      .map((account) => account.name);
  }

  private async compute(): Promise<Computed> {
    const [accountRows, debits, coverage, manual] = await Promise.all([
      this.repository.accounts(),
      this.repository.debits(),
      this.repository.statementCoverage(),
      this.repository.manualMatches(),
    ]);
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
      };

    const first = monthOf(debits[0]!.bookingDate);
    const last = monthOf(debits[debits.length - 1]!.bookingDate);
    const months: string[] = [];
    for (let m = first; m <= last; m = shiftMonth(m, 1)) months.push(m);

    const documents = await this.repository.candidates(
      `${shiftMonth(first, -4)}-01`,
      `${shiftMonth(last, 1)}-15`,
    );
    await this.checkPayees(
      documents.filter((d) => d.source === "MAILBOX" && d.payee === "UNKNOWN"),
    );

    const ownAccounts = new Set(
      accountRows.map((a) => normalizeAccount(a.accountNumber)),
    );
    const payrollNames = payrollNamesOf(debits);
    const classified = debits.map((debit) => {
      const ruled = classifyTransaction(debit, { ownAccounts, payrollNames });
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
    const outcomes = matchMonth({
      debits: classified.map(({ debit, classification, original }) => ({
        id: debit.id,
        bookingDate: debit.bookingDate.toISOString().slice(0, 10),
        amount: debit.amount,
        currency: debit.currency,
        original,
        counterpartyName: debit.counterpartyName,
        counterpartyAccount: normalizeAccount(debit.counterpartyAccount),
        narrative: debit.narrative,
        category: classification.category,
      })),
      documents,
      manual,
      paperOriginals: new Set(
        debits.filter((d) => d.paperOriginalAt).map((d) => d.id),
      ),
    });

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
              number: document.number,
              source: document.source,
            }
          : null,
        matchedBy: outcome.matchedBy,
        comment: debit.comment,
        paperOriginal: debit.paperOriginalAt !== null,
      };
    });
    return { items, months, accounts, coverage, outcomes, documents };
  }

  /**
   * A postafiók-számla vevőjének ellenőrzése, egyszer: a szövegéből, és az
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
  NO_INVOICE_NEEDED: "NONE",
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
