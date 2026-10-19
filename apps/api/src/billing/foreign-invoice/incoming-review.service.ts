import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, prisma, type PrismaClient } from "@acropora/database";
import {
  ACROPORA_COMPANY,
  INCOMING_READING_FIELDS,
  INCOMING_READING_FIELD_LABELS,
  INCOMING_READING_REQUIRED,
  type IncomingDocumentReview,
  type IncomingReadingField,
  type IncomingReadingSource,
  type IncomingReadingValues,
  type IncomingReviewInput,
  type SupplierInvoiceImportResult,
} from "@acropora/types";

import {
  MissingInvoicesService,
  type DocumentPairing,
} from "../../missing-invoices/missing-invoices.service.js";
import { pdfTextLines } from "../../purchasing/supplier-invoice-import/pdf-text-lines.js";
import {
  MAILBOX_ITEM_PREFIX,
  MAILBOX_KIND_CODE,
  mailboxOnlyPairings,
  mailboxOnlyPaidItems,
  mailboxPdfCandidates,
  readingDocumentIds,
  toIncomingListItem,
} from "../incoming-billing-documents.js";
import {
  readForeignInvoice,
  type ForeignReading,
} from "./foreign-invoice-reading.js";
import { prismaErrorSummary } from "./error-summary.js";
import { storedValues, type StoredReading } from "./reading-values.js";
import {
  loadManualPurchasePayments,
  loadPurchaseSubjects,
  lockIncomingKey,
  otherSourceRowFor,
  PURCHASE_ITEM_PREFIX,
  PURCHASE_KIND_CODE,
  PURCHASE_SOURCE,
  purchaseListItem,
  purchaseReading,
  type PurchaseSubject,
} from "../purchase-incoming.js";

/**
 * A POSTAFIÓKOS (KÜLFÖLDI) SZÁMLA ELLENŐRZÉSE (kártya e4c3b0fb; terv:
 * agents/murena/megosztas/kulfoldi-szamla-terv-2026-10-07.md, acrobot 27599).
 *
 * KÉT LÉPÉS, KÉT TÁBLA:
 * 1. A kinyert adat az `IncomingDocumentReading` sorba megy, „Ellenőrizendő”
 *    állapotban. A lista ezzel tölti ki a postafiókos sort, de a könyvelőhöz
 *    ebből egy szám sem megy (Balázs: csak ellenőrzött adat).
 * 2. Jóváhagyáskor egy rendes `IncomingBillingDocument` sor jön létre
 *    `MAILBOX` forrással; onnantól a lista, az adatlap és a havi csomag
 *    ugyanabból olvas, mint a Számlázz.hu soroknál, és a mai duplikáció-szűrés
 *    (`sourceDocumentId`) kiveszi a postafiókos sort.
 *
 * Az OLVASÁS nem ír: a `review` a tárolt sort adja, ha van, különben a PDF-ből
 * számol a memóriában. Írni csak a `save`, az `approve` és az `--apply`-jal
 * futó feldolgozás ír.
 */

type Database = Pick<
  PrismaClient,
  | "incomingBillingDocument"
  | "incomingSupplierDocument"
  | "incomingDocumentReading"
  | "purchaseInvoice"
  | "navIncomingInvoice"
  | "$transaction"
  | "$queryRaw"
>;

const PDF_MAGIC = Buffer.from("%PDF-");
/** a nettó + ÁFA és a bruttó közti kerekítési tűrés, mint az olvasóban */
const SUM_TOLERANCE = new Prisma.Decimal("0.02");

const asDate = (value: string | null) =>
  value === null ? null : new Date(`${value}T00:00:00.000Z`);
const asDecimal = (value: string | null) =>
  value === null ? null : new Prisma.Decimal(value);

function columns(values: IncomingReadingValues) {
  return {
    supplierName: values.supplierName,
    supplierTaxNumber: values.supplierTaxNumber,
    supplierEuTaxNumber: values.supplierEuTaxNumber,
    documentNumber: values.documentNumber,
    issueDate: asDate(values.issueDate),
    fulfillmentDate: asDate(values.fulfillmentDate),
    dueDate: asDate(values.dueDate),
    currency: values.currency,
    netAmount: asDecimal(values.netAmount),
    vatAmount: asDecimal(values.vatAmount),
    grossAmount: asDecimal(values.grossAmount),
  };
}

/**
 * A kézi bevitel egységes alakra: üres szöveg `null`, a deviza nagybetűs, az
 * összeg két tizedes. A DTO az alakot már ellenőrizte; ez a kerekítés.
 */
export function normalizedInput(
  input: IncomingReviewInput,
): IncomingReadingValues {
  const text = (value: string | null | undefined) => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  };
  const amount = (value: string | null | undefined) => {
    const trimmed = text(value);
    return trimmed === null
      ? null
      : new Prisma.Decimal(trimmed.replace(",", ".")).toFixed(2);
  };
  return {
    supplierName: text(input.supplierName),
    supplierTaxNumber: text(input.supplierTaxNumber),
    supplierEuTaxNumber: text(input.supplierEuTaxNumber),
    documentNumber: text(input.documentNumber),
    issueDate: text(input.issueDate),
    fulfillmentDate: text(input.fulfillmentDate),
    dueDate: text(input.dueDate),
    currency: text(input.currency)?.toUpperCase() ?? null,
    netAmount: amount(input.netAmount),
    vatAmount: amount(input.vatAmount),
    grossAmount: amount(input.grossAmount),
  };
}

/**
 * MI HIÁNYZIK A JÓVÁHAGYÁSHOZ, magyar szövegben. Üres lista: jóváhagyható.
 * A kötelező mezőkön túl a nettó + ÁFA = bruttó egyezést is nézi: egy rossz
 * szám a könyvelőnél rosszabb, mint egy hiányzó.
 */
export function approvalProblems(values: IncomingReadingValues): string[] {
  const missing = INCOMING_READING_REQUIRED.filter(
    (field) => values[field] === null,
  );
  const problems = missing.length
    ? [
        `Hiányzó mező: ${missing
          .map((field) => INCOMING_READING_FIELD_LABELS[field])
          .join(", ")}.`,
      ]
    : [];
  if (values.netAmount && values.vatAmount && values.grossAmount) {
    const sum = new Prisma.Decimal(values.netAmount).plus(values.vatAmount);
    if (sum.minus(values.grossAmount).abs().gt(SUM_TOLERANCE))
      problems.push("A nettó és az ÁFA összege nem adja ki a bruttót.");
  }
  return problems;
}

/** A forrás mezőnként: ami a kézi mentésben megváltozott, az `MANUAL` lesz. */
export function mergedSources(
  before: IncomingReadingValues,
  after: IncomingReadingValues,
  sources: Partial<Record<IncomingReadingField, IncomingReadingSource>>,
): Partial<Record<IncomingReadingField, IncomingReadingSource>> {
  const result: Partial<Record<IncomingReadingField, IncomingReadingSource>> =
    {};
  for (const field of INCOMING_READING_FIELDS) {
    if (after[field] === null) continue;
    result[field] =
      before[field] === after[field] && sources[field]
        ? sources[field]
        : "MANUAL";
  }
  return result;
}

export interface PendingReport {
  /** a postafiókos (csak postafiókból ismert, fizetett) sorok száma */
  total: number;
  /** ennyihez van már tárolt olvasat (nem olvassuk újra) */
  alreadyRead: number;
  /** ennyit olvasott ez a futás */
  read: number;
  /** ennyit írt (csak `apply` mellett) */
  written: number;
  /** ennyi sor bukott el (kimaradt, a következő futás újra próbálja) */
  failed: number;
  /** a bukott sorok: dokumentum-azonosító és a hiba fajtája, számla-adat nélkül */
  failures: { documentId: string; error: string }[];
  withText: number;
  withAdapter: number;
  /** ennyiben áll minden kötelező mező (jóváhagyható egy kattintással) */
  complete: number;
  byCurrency: Record<string, number>;
  bySenderDomain: Record<string, number>;
  /** dokumentumonként egy sor, személyes adat nélkül */
  rows: {
    documentId: string;
    date: string;
    currency: string | null;
    senderDomain: string | null;
    hasText: boolean;
    adapter: boolean;
    filled: number;
    missing: IncomingReadingField[];
    warnings: number;
  }[];
}

/** A sornak nincs postafiókos dokumentuma, amin az olvasat állhatna. */
export class NoMailboxDocumentError extends Error {
  override readonly name = "NoMailboxDocumentError";
  constructor() {
    super(
      "Ehhez a sorhoz nincs postafiókos dokumentum, amin az olvasat állhatna.",
    );
  }
}

@Injectable()
export class IncomingReviewService {
  private readonly database: Database = prisma;

  // a teljes osztály típus kell: a Nest a konstruktor-metaadatból injektál
  constructor(private readonly missing: MissingInvoicesService) {}

  /** A tárolt, még nem jóváhagyott olvasatok, a lista kitöltéséhez. */
  async pendingReadings(): Promise<Map<string, IncomingReadingValues>> {
    const rows = await this.database.incomingDocumentReading.findMany({
      where: { state: "TO_REVIEW" },
    });
    return new Map(rows.map((row) => [row.documentId, storedValues(row)]));
  }

  /**
   * Egy postafiókos sor ellenőrző lapja. A jóváhagyott sor is megnyílik
   * (egy nyitva felejtett lap „Ellenőrzött”-et mutat, nem 404-et).
   */
  async review(itemId: string): Promise<IncomingDocumentReview> {
    if (itemId.startsWith(PURCHASE_ITEM_PREFIX))
      return this.purchaseReview(itemId.slice(PURCHASE_ITEM_PREFIX.length));
    const documentId = this.documentIdOf(itemId);
    const pairings = await this.missing.documentPairings();
    const stored = await this.storedReadingOf(documentId, pairings);
    if (stored?.state === "VERIFIED") {
      const { pairing } = await this.pairingOf(documentId, true, pairings);
      return this.view(pairing, stored, null);
    }
    const { pairing } = await this.pairingOf(documentId, false, pairings);
    const computed = stored ? null : await this.computeReading(pairing);
    return this.view(pairing, stored, computed);
  }

  /** A javított mezők mentése, jóváhagyás nélkül. */
  async save(
    itemId: string,
    input: IncomingReviewInput,
    userId: string,
  ): Promise<IncomingDocumentReview> {
    if (itemId.startsWith(PURCHASE_ITEM_PREFIX)) {
      const subject = await this.purchaseSubject(itemId);
      await this.storeManualFor(
        scanOf(subject),
        async () => purchaseBase(subject),
        input,
        userId,
      );
      return this.purchaseReview(subject.purchaseInvoiceId);
    }
    const documentId = this.documentIdOf(itemId);
    const { pairing } = await this.pairingOf(documentId);
    const stored = await this.storeManual(pairing, input, userId);
    return this.view(pairing, stored, null);
  }

  /**
   * JÓVÁHAGYÁS: a (javított) értékekből rendes bejövő számla lesz. Hiányos
   * vagy ellentmondó adattal 400, már jóváhagyott sorra 409.
   */
  async approve(
    itemId: string,
    input: IncomingReviewInput | null,
    userId: string,
  ): Promise<IncomingDocumentReview> {
    if (itemId.startsWith(PURCHASE_ITEM_PREFIX))
      return this.purchaseApprove(itemId, input, userId);
    const documentId = this.documentIdOf(itemId);
    const pairings = await this.missing.documentPairings();
    const existing = await this.storedReadingOf(documentId, pairings);
    if (existing?.state === "VERIFIED")
      throw new ConflictException("Ez a számla már jóvá van hagyva.");
    const { pairing } = await this.pairingOf(documentId, false, pairings);
    const values = input
      ? normalizedInput(input)
      : existing
        ? storedValues(existing)
        : (await this.computeReading(pairing)).values;
    const problems = approvalProblems(values);
    if (problems.length) throw new BadRequestException(problems.join(" "));
    const stored = await this.storeManual(pairing, values, userId);
    // az olvasat dokumentuma: összevont számlánál nem a sor azonosítója (P2003)
    const readingDocumentId = stored.documentId;
    const document = await this.database.incomingSupplierDocument.findUnique({
      where: { id: readingDocumentId },
      select: { receivedAt: true },
    });
    /*
      A sor a FÁJLT HORDOZÓ dokumentumra mutasson (barracuda visszamérése): a
      PDF-út és a banki párosítás is ezen a kulcson megy, és összevont
      jelöltnél a fájl az eredetinél áll. A párosítás-térkép az aliasokat is
      ismeri, tehát a fizetettség így is a bankból jön.
    */
    const { pdfDocumentId } = await this.sourceOf(pairing);
    const verified = await this.database.$transaction(async (tx) => {
      const taken = await tx.incomingBillingDocument.findUnique({
        where: {
          source_externalId: { source: "MAILBOX", externalId: documentId },
        },
        select: { id: true },
      });
      if (taken)
        throw new ConflictException("Ez a számla már jóvá van hagyva.");
      const now = new Date();
      const row = await tx.incomingBillingDocument.create({
        data: {
          source: "MAILBOX",
          externalId: documentId,
          // nincs feed-üzenet: a forrás maga a postafiókos dokumentum
          feedMessageId: documentId,
          feedReceivedAt: document?.receivedAt ?? now,
          kindCode: MAILBOX_KIND_CODE,
          documentNumber: values.documentNumber!,
          electronic: false,
          issueDate: asDate(values.issueDate)!,
          fulfillmentDate: asDate(values.fulfillmentDate),
          dueDate: asDate(values.dueDate),
          currency: values.currency!,
          supplierName: values.supplierName!,
          supplierTaxNumber: values.supplierTaxNumber,
          supplierEuTaxNumber: values.supplierEuTaxNumber,
          buyerName: ACROPORA_COMPANY.name,
          netAmount: asDecimal(values.netAmount)!,
          vatAmount: asDecimal(values.vatAmount)!,
          grossAmount: asDecimal(values.grossAmount)!,
          lines: [],
          vatSummary: [],
          payments: [],
          // a fizetés a banki párosításból jön, mint a postafiókos sornál
          paymentsKnown: false,
          paidAmount: new Prisma.Decimal(0),
          sourceDocumentId: pdfDocumentId ?? documentId,
          hasPdf: pdfDocumentId !== null,
        },
      });
      const reading = await tx.incomingDocumentReading.update({
        where: { documentId: readingDocumentId },
        data: {
          state: "VERIFIED",
          reviewedAt: now,
          reviewedByUserId: userId,
          incomingBillingDocumentId: row.id,
        },
      });
      await tx.auditLog.create({
        data: {
          userId,
          action: "billing.incoming-reading.approved",
          entityType: "IncomingBillingDocument",
          entityId: row.id,
          metadata: {
            documentId,
            readingId: reading.id,
            // mely mezőket írt át ember a kinyerthez képest
            manualFields: Object.entries(
              (reading.sources ?? {}) as Record<string, string>,
            )
              .filter(([, source]) => source === "MANUAL")
              .map(([field]) => field),
          },
        },
      });
      return reading;
    });
    return this.view(pairing, verified, null);
  }

  /**
   * A MÉG NEM OLVASOTT POSTAFIÓKOS SOROK KINYERÉSE. Alapból olvasatot NEM ír:
   * csak számol és jelent (az éles számlálás, acrobot 27599). A párosítás
   * számítása (`documentPairings`) a vevő-ítélet gyorsítótárát (`payeeCheck`)
   * kitöltheti, mint a lista megnyitása (acrobot 27658). `apply` mellett a
   * még nem olvasott sorok „Ellenőrizendő” olvasatot kapnak; a már tárolthoz
   * (és a kézzel javítotthoz) nem nyúl.
   */
  async readPending(options: {
    apply: boolean;
    /** YYYY-MM-DD: csak az ennél nem régebbi számlák */
    since?: string | null;
    limit?: number | null;
  }): Promise<PendingReport> {
    const [feed, pairings, stored] = await Promise.all([
      this.database.incomingBillingDocument.findMany({
        select: { sourceDocumentId: true, documentNumber: true },
      }),
      this.missing.documentPairings(),
      this.database.incomingDocumentReading.findMany({
        select: { documentId: true },
      }),
    ]);
    const known = new Set(stored.map((row) => row.documentId));
    const pending = mailboxOnlyPairings(feed, pairings).filter(
      (pairing) => !options.since || pairing.document.date >= options.since,
    );
    const report: PendingReport = {
      total: pending.length,
      alreadyRead: 0,
      read: 0,
      written: 0,
      failed: 0,
      failures: [],
      withText: 0,
      withAdapter: 0,
      complete: 0,
      byCurrency: {},
      bySenderDomain: {},
      rows: [],
    };
    // soronként egyszer nő: egy íráskor bukott sor olvasott ÉS kimaradt is,
    // a korlátba mégis csak egyszer számít (barracuda #1691)
    let attempted = 0;
    for (const pairing of pending) {
      if (readingDocumentIds(pairing.document).some((id) => known.has(id))) {
        report.alreadyRead += 1;
        continue;
      }
      // a bukott sor is próbálkozás: egy csupa-hibás futás is megáll a korlátnál
      if (options.limit && attempted >= options.limit) break;
      attempted += 1;
      /*
        EGY SOR HIBÁJA NEM ÁLLÍTJA MEG A TÖBBIT (kulfoldi-szamla-olvasas-hiba):
        2026-10-13 óta egy írhatatlan sor minden futást ugyanott állított meg.
        A sor kimarad, a következő futás újra próbálja; a hiba fajtája a
        jelentésbe kerül, a számla adata nem.
      */
      try {
        const source = await this.sourceOf(pairing);
        const reading = await this.readingFrom(pairing, source);
        report.read += 1;
        const missing = INCOMING_READING_REQUIRED.filter(
          (field) => reading.values[field] === null,
        );
        const currency = reading.values.currency;
        const domain = senderDomain(source.sender);
        if (reading.hasText) report.withText += 1;
        if (source.adapter) report.withAdapter += 1;
        if (!approvalProblems(reading.values).length) report.complete += 1;
        report.byCurrency[currency ?? "?"] =
          (report.byCurrency[currency ?? "?"] ?? 0) + 1;
        report.bySenderDomain[domain ?? "?"] =
          (report.bySenderDomain[domain ?? "?"] ?? 0) + 1;
        report.rows.push({
          documentId: pairing.document.id,
          date: pairing.document.date,
          currency,
          senderDomain: domain,
          hasText: reading.hasText,
          adapter: !!source.adapter,
          filled: INCOMING_READING_FIELDS.filter(
            (field) => reading.values[field] !== null,
          ).length,
          missing,
          warnings: reading.warnings.length,
        });
        if (options.apply) {
          // az olvasat egy valódi postafiókos dokumentumon áll; összevont
          // számlánál a sor saját azonosítója a NAV-soré lehet (P2003, 2026-10-14)
          const documentId = await this.readingDocumentId(pairing);
          await this.database.incomingDocumentReading.create({
            data: {
              documentId,
              ...columns(reading.values),
              sources: reading.sources,
              warnings: reading.warnings,
              hasText: reading.hasText,
            },
          });
          report.written += 1;
        }
      } catch (error) {
        report.failed += 1;
        report.failures.push({
          documentId: pairing.document.id,
          error: prismaErrorSummary(error),
        });
      }
    }
    return report;
  }

  /** A PDF-ből számolt olvasat, írás nélkül. */
  async computeReading(pairing: DocumentPairing): Promise<ForeignReading> {
    return this.readingFrom(pairing, await this.sourceOf(pairing));
  }

  private async readingFrom(
    pairing: DocumentPairing,
    source: Awaited<ReturnType<IncomingReviewService["sourceOf"]>>,
  ): Promise<ForeignReading> {
    let lines: string[] | null = null;
    if (source.pdf) {
      try {
        lines = await pdfTextLines(source.pdf);
      } catch {
        lines = null; // olvashatatlan PDF: minden mező kézi, mint szkenneltnél
      }
      if (lines && !lines.some((line) => line.trim())) lines = null;
    }
    const document = pairing.document;
    return readForeignInvoice({
      lines,
      adapter: source.adapter,
      pairing: {
        number: document.number,
        supplierName: document.supplierName,
        date: document.date,
        gross: document.gross?.toFixed(2) ?? null,
        currency: document.currency,
        debits: pairing.debits,
      },
    });
  }

  /**
   * A dokumentum PDF-je és illesztő-eredménye. Összevont jelöltnél a fájl az
   * eredetinél van, ezért ugyanabban a sorrendben keresünk, mint a PDF
   * végpont (`mailboxPdfCandidates`); a nem PDF tartalom kimarad.
   */
  private async sourceOf(pairing: DocumentPairing): Promise<{
    pdf: Uint8Array | null;
    /** a PDF-et ténylegesen hordozó dokumentum (összevont jelöltnél az eredeti) */
    pdfDocumentId: string | null;
    adapter: SupplierInvoiceImportResult | null;
    sender: string | null;
  }> {
    let pdf: Uint8Array | null = null;
    let pdfDocumentId: string | null = null;
    let adapter: SupplierInvoiceImportResult | null = null;
    let sender: string | null = null;
    for (const id of mailboxPdfCandidates(pairing.document)) {
      const row = await this.database.incomingSupplierDocument.findUnique({
        where: { id },
        select: { content: true, importResult: true, sender: true },
      });
      if (!row) continue;
      sender ??= row.sender;
      adapter ??=
        (row.importResult as unknown as SupplierInvoiceImportResult | null) ??
        null;
      const bytes = Buffer.from(row.content);
      if (!pdf && bytes.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) {
        pdf = new Uint8Array(bytes);
        pdfDocumentId = id;
      }
    }
    return { pdf, pdfDocumentId, adapter, sender };
  }

  /**
   * A kézi (vagy jóváhagyott) értékek tárolása. Ha még nincs tárolt sor, a
   * kinyert olvasat a kiinduló pont, hogy a forrás mezőnként megmaradjon.
   */
  private async storeManual(
    pairing: DocumentPairing,
    input: IncomingReviewInput,
    userId: string,
  ): Promise<StoredReading> {
    let documentId: string;
    try {
      documentId = await this.readingDocumentId(pairing);
    } catch (error) {
      if (error instanceof NoMailboxDocumentError)
        throw new BadRequestException(error.message);
      throw error;
    }
    return this.storeManualFor(
      documentId,
      () => this.computeReading(pairing),
      input,
      userId,
    );
  }

  /**
   * MELYIK DOKUMENTUMON ÁLL (vagy fog állni) EGY SOR OLVASATA (P2003,
   * 2026-10-14): ha már van olvasat a sor azonosítóinak egyikén
   * (`readingDocumentIds`), azon; különben az első, ami valódi
   * `IncomingSupplierDocument`. Egy összevont számla saját azonosítója a
   * NAV-soré lehet, arra az idegen kulcs nem enged olvasatot.
   */
  private async readingDocumentId(pairing: DocumentPairing): Promise<string> {
    const ids = readingDocumentIds(pairing.document);
    const stored = await this.database.incomingDocumentReading.findMany({
      where: { documentId: { in: ids } },
      select: { documentId: true },
    });
    const storedOn = ids.find((id) =>
      stored.some((row) => row.documentId === id),
    );
    if (storedOn) return storedOn;
    const documents = await this.database.incomingSupplierDocument.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    const document = ids.find((id) => documents.some((row) => row.id === id));
    if (!document) throw new NoMailboxDocumentError();
    return document;
  }

  /** Egy sor tárolt olvasata az azonosítói közül az elsőn, amin van; vagy `null`. */
  private async storedReadingOf(
    documentId: string,
    pairings: Map<string, DocumentPairing>,
  ): Promise<StoredReading | null> {
    const pairing = pairings.get(documentId);
    const ids = pairing ? readingDocumentIds(pairing.document) : [documentId];
    const rows = await this.database.incomingDocumentReading.findMany({
      where: { documentId: { in: ids } },
    });
    for (const id of ids) {
      const row = rows.find((candidate) => candidate.documentId === id);
      if (row) return row;
    }
    return null;
  }

  /**
   * A kézi mentés egy dokumentum olvasatára, a forrástól függetlenül: a
   * postafiókos sornál a PDF-ből kinyert, a beszerzésből jött sornál a
   * rögzítésből kitöltött olvasat a kiinduló pont (`base`).
   */
  private async storeManualFor(
    documentId: string,
    computeBase: () => Promise<
      Pick<ForeignReading, "values" | "sources" | "warnings" | "hasText">
    >,
    input: IncomingReviewInput,
    userId: string,
  ): Promise<StoredReading> {
    const after = normalizedInput(input);
    const stored = await this.database.incomingDocumentReading.findUnique({
      where: { documentId },
    });
    if (stored?.state === "VERIFIED")
      throw new ConflictException("Ez a számla már jóvá van hagyva.");
    const base = stored
      ? {
          values: storedValues(stored),
          sources: (stored.sources ?? {}) as ForeignReading["sources"],
          warnings: (stored.warnings ?? []) as string[],
          hasText: stored.hasText,
        }
      : await computeBase();
    const sources = mergedSources(base.values, after, base.sources);
    const changed = INCOMING_READING_FIELDS.filter(
      (field) => base.values[field] !== after[field],
    );
    return this.database.$transaction(async (tx) => {
      const row = await tx.incomingDocumentReading.upsert({
        where: { documentId },
        create: {
          documentId,
          ...columns(after),
          sources,
          warnings: base.warnings,
          hasText: base.hasText,
        },
        update: { ...columns(after), sources },
      });
      if (changed.length)
        await tx.auditLog.create({
          data: {
            userId,
            action: "billing.incoming-reading.saved",
            entityType: "IncomingDocumentReading",
            entityId: row.id,
            metadata: { documentId, changedFields: changed },
          },
        });
      return row;
    });
  }

  /**
   * A BESZERZÉSBŐL JÖTT SOR (kártya 83f31a95): csak a listán álló számla
   * (`loadPurchaseSubjects`, ugyanaz a feltétel), különben 404.
   */
  private async purchaseSubject(itemId: string): Promise<PurchaseSubject> {
    const [subject] = await loadPurchaseSubjects(
      this.database,
      itemId.slice(PURCHASE_ITEM_PREFIX.length),
    );
    if (!subject)
      throw new NotFoundException("Nincs ilyen ellenőrizendő számla.");
    return subject;
  }

  /**
   * A beszerzésből jött sor ellenőrző lapja. A már jóváhagyott is megnyílik
   * (a jóváhagyott sor és az olvasata alapján), mint a postafiókosnál.
   */
  private async purchaseReview(
    purchaseInvoiceId: string,
  ): Promise<IncomingDocumentReview> {
    const approved = await this.database.incomingBillingDocument.findUnique({
      where: {
        source_externalId: {
          source: PURCHASE_SOURCE,
          externalId: purchaseInvoiceId,
        },
      },
    });
    if (approved) {
      const stored = await this.database.incomingDocumentReading.findUnique({
        where: { incomingBillingDocumentId: approved.id },
      });
      // ugyanaz a kézi „Fizetve” jelölés, mint a listán és az adatlapon (a beszerzési számla mezőjéből)
      const manualPaid = await loadManualPurchasePayments(this.database, [
        approved,
      ]);
      return this.purchaseView(
        {
          ...toIncomingListItem(
            approved,
            new Map(),
            false,
            manualPaid.get(approved.externalId) ?? null,
          ),
          review: "VERIFIED",
        },
        stored,
        null,
      );
    }
    const subject = await this.purchaseSubject(
      `${PURCHASE_ITEM_PREFIX}${purchaseInvoiceId}`,
    );
    const stored = subject.scanIds.length
      ? await this.database.incomingDocumentReading.findUnique({
          where: { documentId: subject.scanIds[0]! },
        })
      : null;
    const base = purchaseBase(subject);
    const values = stored ? storedValues(stored) : base.values;
    return this.purchaseView(
      purchaseListItem(subject, await this.missing.documentPairings(), values),
      stored,
      base,
    );
  }

  /**
   * JÓVÁHAGYÁS a beszerzésből jött sorra: ugyanaz a lépéssor, mint a
   * postafiókosnál, de a sor `PURCHASE` forrású, és a beszerzési számlára
   * mutat. Kép nélkül nem hagyható jóvá: a könyvelőnek a PDF kell.
   */
  private async purchaseApprove(
    itemId: string,
    input: IncomingReviewInput | null,
    userId: string,
  ): Promise<IncomingDocumentReview> {
    const subject = await this.purchaseSubject(itemId);
    const documentId = scanOf(subject);
    const existing = await this.database.incomingDocumentReading.findUnique({
      where: { documentId },
    });
    if (existing?.state === "VERIFIED")
      throw new ConflictException("Ez a számla már jóvá van hagyva.");
    const base = purchaseBase(subject);
    const values = input
      ? normalizedInput(input)
      : existing
        ? storedValues(existing)
        : base.values;
    const problems = approvalProblems(values);
    if (problems.length) throw new BadRequestException(problems.join(" "));
    await this.storeManualFor(documentId, async () => base, values, userId);
    await this.database.$transaction(async (tx) => {
      /*
        THE PURCHASE ROW FIRST, THEN THE KEY (barracuda's #1648 review). The
        cancel and the correction hold the purchase invoice's row before they
        take the key's lock, so every path locks in one order (no deadlock),
        and a purchase cancelled while this waited is refused here: the
        subject was read outside the transaction.
      */
      const [purchase] = await tx.$queryRaw<{ status: string }[]>`
        SELECT status::text AS status FROM "PurchaseInvoice"
        WHERE id = ${subject.purchaseInvoiceId} FOR SHARE`;
      if (purchase?.status !== "POSTED")
        throw new ConflictException(
          "Ez a beszerzési számla közben sztornózva lett, bejövő számlaként nem hagyható jóvá.",
        );
      // the feed writes the same invoice under the same lock (acrobot 28369)
      const key = await lockIncomingKey(tx, values);
      const known = key
        ? await otherSourceRowFor(tx, values.documentNumber!, key)
        : null;
      if (known)
        throw new ConflictException(
          "Ez a számla közben megérkezett a Számlázz.hu-ból vagy a postafiókból, a beszerzésből már nem hagyható jóvá.",
        );
      const taken = await tx.incomingBillingDocument.findUnique({
        where: {
          source_externalId: {
            source: PURCHASE_SOURCE,
            externalId: subject.purchaseInvoiceId,
          },
        },
        select: { id: true },
      });
      if (taken)
        throw new ConflictException("Ez a számla már jóvá van hagyva.");
      const now = new Date();
      const row = await tx.incomingBillingDocument.create({
        data: {
          source: PURCHASE_SOURCE,
          externalId: subject.purchaseInvoiceId,
          // nincs feed-üzenet: a forrás maga a rögzített beszerzési számla
          feedMessageId: subject.purchaseInvoiceId,
          feedReceivedAt: subject.scanReceivedAt ?? now,
          kindCode: PURCHASE_KIND_CODE,
          documentNumber: values.documentNumber!,
          electronic: false,
          issueDate: asDate(values.issueDate)!,
          fulfillmentDate: asDate(values.fulfillmentDate),
          dueDate: asDate(values.dueDate),
          currency: values.currency!,
          exchangeRate: subject.exchangeRate,
          supplierName: values.supplierName!,
          supplierTaxNumber: values.supplierTaxNumber,
          supplierEuTaxNumber: values.supplierEuTaxNumber,
          buyerName: ACROPORA_COMPANY.name,
          netAmount: asDecimal(values.netAmount)!,
          vatAmount: asDecimal(values.vatAmount)!,
          grossAmount: asDecimal(values.grossAmount)!,
          lines: [],
          vatSummary: [],
          payments: [],
          paymentsKnown: false,
          paidAmount: new Prisma.Decimal(0),
          sourceDocumentId: documentId,
          hasPdf: true,
        },
      });
      const reading = await tx.incomingDocumentReading.update({
        where: { documentId },
        data: {
          state: "VERIFIED",
          reviewedAt: now,
          reviewedByUserId: userId,
          incomingBillingDocumentId: row.id,
        },
      });
      await tx.auditLog.create({
        data: {
          userId,
          action: "billing.incoming-reading.approved",
          entityType: "IncomingBillingDocument",
          entityId: row.id,
          metadata: {
            documentId,
            readingId: reading.id,
            purchaseInvoiceId: subject.purchaseInvoiceId,
            manualFields: Object.entries(
              (reading.sources ?? {}) as Record<string, string>,
            )
              .filter(([, source]) => source === "MANUAL")
              .map(([field]) => field),
          },
        },
      });
    });
    return this.purchaseReview(subject.purchaseInvoiceId);
  }

  private purchaseView(
    item: IncomingDocumentReview["item"],
    stored: StoredReading | null,
    base: ReturnType<typeof purchaseBase> | null,
  ): IncomingDocumentReview {
    const values = stored
      ? storedValues(stored)
      : (base?.values ?? normalizedInput({} as IncomingReviewInput));
    const state = stored?.state ?? "TO_REVIEW";
    return {
      item: { ...item, review: state },
      state,
      values,
      sources: stored
        ? ((stored.sources ?? {}) as ForeignReading["sources"])
        : (base?.sources ?? {}),
      warnings: stored ? ((stored.warnings ?? []) as string[]) : [],
      hasText: stored?.hasText ?? false,
      readAt: stored ? stored.readAt.toISOString() : null,
    };
  }

  private documentIdOf(itemId: string): string {
    if (!itemId.startsWith(MAILBOX_ITEM_PREFIX))
      throw new NotFoundException("Nincs ilyen ellenőrizendő számla.");
    return itemId.slice(MAILBOX_ITEM_PREFIX.length);
  }

  /**
   * CSAK az a sor ellenőrizhető, amit a lista postafiókos sorként mutat
   * (ugyanaz a feltétel, mint a PDF végpontnál); alias és nem fizetett
   * jelölt 404. A jóváhagyott sor már a feedből jön, ezért ott a duplikáció-
   * szűrést kihagyjuk (`verified`).
   */
  private async pairingOf(
    documentId: string,
    verified = false,
    // the pairings, if the caller has them already (one computation per request; barracuda #1693)
    known?: Map<string, DocumentPairing>,
  ): Promise<{ pairing: DocumentPairing }> {
    const [feed, pairings] = await Promise.all([
      this.database.incomingBillingDocument.findMany({
        where: verified ? { source: "SZAMLAZZ" } : undefined,
        select: { sourceDocumentId: true, documentNumber: true },
      }),
      known ?? this.missing.documentPairings(),
    ]);
    const pairing = pairings.get(documentId);
    if (
      !pairing ||
      pairing.document.id !== documentId ||
      mailboxOnlyPairings(feed, new Map([[documentId, pairing]])).length === 0
    )
      throw new NotFoundException("Nincs ilyen ellenőrizendő számla.");
    return { pairing };
  }

  private view(
    pairing: DocumentPairing,
    stored: StoredReading | null,
    computed: ForeignReading | null,
  ): IncomingDocumentReview {
    const values = stored
      ? storedValues(stored)
      : (computed?.values ?? normalizedInput({} as IncomingReviewInput));
    const state = stored?.state ?? "TO_REVIEW";
    const [item] = mailboxOnlyPaidItems(
      [],
      new Map([[pairing.document.id, pairing]]),
      new Map([[pairing.document.id, values]]),
    );
    return {
      item: { ...item!, review: state },
      state,
      values,
      sources: stored
        ? ((stored.sources ?? {}) as ForeignReading["sources"])
        : (computed?.sources ?? {}),
      warnings: stored
        ? ((stored.warnings ?? []) as string[])
        : (computed?.warnings ?? []),
      hasText: stored?.hasText ?? computed?.hasText ?? false,
      readAt: stored ? stored.readAt.toISOString() : null,
    };
  }
}

/** A feladó domainje (`Név <a@b.hu>` vagy `a@b.hu`), a jelentéshez. */
export function senderDomain(sender: string | null): string | null {
  const match = sender?.match(/@([^\s>]+)/);
  return match ? match[1]!.toLowerCase() : null;
}

/** A beszerzésből kitöltött kiinduló olvasat, PDF-szöveg nélkül. */
function purchaseBase(subject: PurchaseSubject) {
  return {
    ...purchaseReading(subject),
    warnings: [] as string[],
    hasText: false,
  };
}

/** Az olvasat a beszerzés első képén ül; kép nélkül nincs mit jóváhagyni. */
function scanOf(subject: PurchaseSubject): string {
  const scan = subject.scanIds[0];
  if (!scan)
    throw new ConflictException(
      "Előbb csatold a számla képét a beszerzési számlához: ellenőrizni és jóváhagyni csak képpel lehet.",
    );
  return scan;
}
