import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  Optional,
} from "@nestjs/common";
import { Prisma, prisma, type SyncRunTrigger } from "@acropora/database";

import { storageKeyFor } from "../../service-assets/document-store/document-storage-key.js";
import type { DocumentStore } from "../../service-assets/document-store/document-store.js";
import {
  DOCUMENT_STORE,
  documentStoreEnabled,
} from "../../service-assets/document-store/document-store.provider.js";
import {
  EBIZ_ENV,
  EBIZ_PAGE_LIMIT,
  EbizClient,
  EbizError,
  type EbizInvoiceListItem,
} from "./ebiz.client.js";
import { invoiceNumberKey } from "../../billing/external-billing-one-row.js";
import {
  ebizListFields,
  ebizNewRow,
  ebizPayment,
  pagingStep,
} from "./ebiz-invoice.js";

/**
 * THE DAILY eBIZ SYNC (Balázs, 2026-10-02 18:22 UTC): every invoice in the
 * eBIZ list, the new ones with their detail and PDF, the known ones with
 * their payment and cancellation state. Read only towards eBIZ; it writes our
 * own `ExternalBillingDocument` rows (source `EBIZ`) and an `EbizSyncRun`.
 *
 * - No key: nothing is called and no run is written; the system-status row
 *   says "not configured" from the environment.
 * - A failed detail or PDF does not stop the run: the row is kept, counted
 *   in `failedCount`, and its PDF is tried again on the next run.
 * - The PDF needs the document store (`DOCUMENT_STORE_ROOT`); without it the
 *   row is kept with `pdfMissingReason` and tried again later.
 * - One run at a time (`activeKey`); a run left RUNNING for three hours is
 *   closed as stale, like the GLS sync.
 */
const ACTIVE_KEY = "ebiz-invoice-sync";
const STALE_RUN_AFTER_MS = 3 * 60 * 60 * 1000;
/** A hard stop on paging, far above today's ~20 pages. */
const MAX_PAGES = 2000;
export const EBIZ_PDF_DOCUMENT_ID = "ebiz.pdf";

export interface EbizSyncCounts {
  fetchedCount: number;
  createdCount: number;
  updatedCount: number;
  pdfStoredCount: number;
  failedCount: number;
}

export type EbizSyncResult =
  | { state: "NOT_CONFIGURED" }
  | ({ state: "APPLIED"; runId: string } & EbizSyncCounts);

/** What the sync needs from the database; the spec fakes it. */
export interface EbizSyncStore {
  startRun(trigger: SyncRunTrigger): Promise<string>;
  finishRun(id: string, counts: EbizSyncCounts): Promise<void>;
  failRun(id: string, counts: EbizSyncCounts, errorCode: string): Promise<void>;
  /**
   * The rows these eBIZ ids already have, keyed by the eBIZ id: their own
   * EBIZ rows, and the Számlázz.hu rows they were linked to (`ebizExternalId`).
   */
  existing(externalIds: string[]): Promise<
    Map<
      string,
      {
        id: string;
        source: string;
        pdfStorageKey: string | null;
        cancelled: boolean;
        externalPaymentStatus: string | null;
        grossAmount: string;
      }
    >
  >;
  /**
   * The Számlázz.hu rows of these invoice numbers that no eBIZ id is linked to
   * yet, keyed by `invoiceNumberKey` (one own invoice number, one row).
   */
  szamlazzTwins(
    invoiceNumbers: string[],
  ): Promise<Map<string, { id: string; pdfStorageKey: string | null }>>;
  /** Records on a Számlázz.hu row the eBIZ id of the same invoice. */
  linkEbiz(id: string, ebizExternalId: string): Promise<void>;
  create(data: ReturnType<typeof ebizNewRow>): Promise<{ id: string }>;
  update(id: string, data: Record<string, unknown>): Promise<void>;
  setPdf(
    id: string,
    pdfStorageKey: string | null,
    pdfMissingReason: string | null,
  ): Promise<void>;
}

/**
 * THE FIRST ISSUE DATE WE TAKE FROM eBIZ (owner, 2026-10-02 19:44 UTC: "Ebizbol
 * nem kellenek a regi szamlak. Csak oktober 1-tol"). The older invoices are
 * never imported, neither on the first run nor later. `OTP_EBIZ_SINCE`
 * (YYYY-MM-DD) can move it; anything else falls back to the owner's date.
 */
export const EBIZ_DEFAULT_SINCE = "2026-10-01";

export function ebizSince(env: NodeJS.ProcessEnv): string {
  const raw = env.OTP_EBIZ_SINCE?.trim() ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : EBIZ_DEFAULT_SINCE;
}

export const EBIZ_SYNC_STORE = Symbol("EBIZ_SYNC_STORE");

const codeOf = (error: unknown, fallback: string): string => {
  const code =
    error instanceof EbizError
      ? error.code
      : error instanceof Error
        ? error.message
        : "";
  return /^[A-Z0-9_:.-]+$/.test(code) ? code : fallback;
};

@Injectable()
export class EbizSyncService {
  private readonly logger = new Logger("EbizSync");

  constructor(
    private readonly client: EbizClient,
    @Inject(EBIZ_SYNC_STORE) private readonly store: EbizSyncStore,
    @Inject(DOCUMENT_STORE) private readonly documents: DocumentStore,
    @Optional()
    @Inject(EBIZ_ENV)
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  async run(
    trigger: SyncRunTrigger,
    now: () => Date = () => new Date(),
  ): Promise<EbizSyncResult> {
    if (!this.client.configured()) return { state: "NOT_CONFIGURED" };
    const runId = await this.store.startRun(trigger);
    const counts: EbizSyncCounts = {
      fetchedCount: 0,
      createdCount: 0,
      updatedCount: 0,
      pdfStoredCount: 0,
      failedCount: 0,
    };
    try {
      const since = ebizSince(this.env);
      const invoices = (await this.listAll()).filter(
        (invoice) => invoice.issueDate.slice(0, 10) >= since,
      );
      counts.fetchedCount = invoices.length;
      const known = await this.store.existing(
        invoices.map((invoice) => String(invoice.id)),
      );
      const twins = await this.store.szamlazzTwins(
        invoices
          .filter((invoice) => !known.has(String(invoice.id)))
          .map((invoice) => invoice.invoiceNumber),
      );
      for (const invoice of invoices) {
        const row = known.get(String(invoice.id));
        const twin = row
          ? undefined
          : twins.get(invoiceNumberKey(invoice.invoiceNumber));
        if (twin) {
          // Számlázz.hu already has this invoice: no second row, only the PDF
          await this.store.linkEbiz(twin.id, String(invoice.id));
          counts.updatedCount++;
          if (!twin.pdfStorageKey)
            await this.storePdf(twin.id, invoice, counts);
          continue;
        }
        if (!row) {
          let detail = null;
          try {
            detail = await this.client.getInvoice(invoice.id);
          } catch (error) {
            counts.failedCount++;
            this.logger.warn(
              `eBIZ ${invoice.invoiceNumber}: részletek nélkül (${codeOf(error, "EBIZ_DETAIL_FAILED")})`,
            );
          }
          const created = await this.store.create(
            ebizNewRow(invoice, detail, now()),
          );
          counts.createdCount++;
          await this.storePdf(created.id, invoice, counts);
          continue;
        }
        // a Számlázz.hu row keeps Számlázz.hu's data and payments
        if (row.source === "EBIZ" && this.changed(invoice, row)) {
          const payment = ebizPayment(invoice, null);
          await this.store.update(row.id, {
            ...ebizListFields(invoice),
            paymentsKnown: payment.paymentsKnown,
            paidAmount: payment.paidAmount,
          });
          counts.updatedCount++;
        }
        if (!row.pdfStorageKey) await this.storePdf(row.id, invoice, counts);
      }
      await this.store.finishRun(runId, counts);
      return { state: "APPLIED", runId, ...counts };
    } catch (error) {
      await this.store.failRun(
        runId,
        counts,
        codeOf(error, "EBIZ_SYNC_FAILED"),
      );
      throw error;
    }
  }

  /** Only what eBIZ can change after issue: payment and cancellation. */
  private changed(
    invoice: EbizInvoiceListItem,
    row: { cancelled: boolean; externalPaymentStatus: string | null },
  ): boolean {
    return (
      row.cancelled !== (invoice.cancelled === true) ||
      row.externalPaymentStatus !== (invoice.paymentStatus ?? null)
    );
  }

  private async storePdf(
    rowId: string,
    invoice: EbizInvoiceListItem,
    counts: EbizSyncCounts,
  ): Promise<void> {
    if (!documentStoreEnabled(this.env)) {
      await this.store.setPdf(rowId, null, "DOCUMENT_STORE_NOT_CONFIGURED");
      return;
    }
    try {
      const bytes = await this.client.downloadInvoicePdf(invoice.id);
      const key = {
        owner: "external-invoice" as const,
        ownerId: rowId,
        documentId: EBIZ_PDF_DOCUMENT_ID,
      };
      await this.documents.put(key, bytes);
      await this.store.setPdf(rowId, storageKeyFor(key), null);
      counts.pdfStoredCount++;
    } catch (error) {
      counts.failedCount++;
      await this.store.setPdf(rowId, null, codeOf(error, "EBIZ_PDF_FAILED"));
    }
  }

  /**
   * Every invoice, deduplicated by id. Page 0, then offset 1 to learn how
   * the API counts (`pagingStep`), then onwards until a short or empty page,
   * the reported total, or a page that brings nothing new.
   */
  private async listAll(): Promise<EbizInvoiceListItem[]> {
    const all = new Map<number, EbizInvoiceListItem>();
    const first = await this.client.listInvoices(0);
    for (const invoice of first.data) all.set(invoice.id, invoice);
    const total = first.pager?.total;
    if (first.data.length < EBIZ_PAGE_LIMIT) return [...all.values()];
    const second = await this.client.listInvoices(1);
    for (const invoice of second.data) all.set(invoice.id, invoice);
    const step = pagingStep(first.data, second.data, EBIZ_PAGE_LIMIT);
    if (second.data.length < EBIZ_PAGE_LIMIT) return [...all.values()];
    let offset = step === 1 ? 2 : EBIZ_PAGE_LIMIT;
    let last = second;
    for (let page = 2; page < MAX_PAGES; page++) {
      if (last.data.length === 0) break;
      if (typeof total === "number" && all.size >= total) break;
      const next = await this.client.listInvoices(offset);
      const before = all.size;
      for (const invoice of next.data) all.set(invoice.id, invoice);
      if (next.data.length < EBIZ_PAGE_LIMIT || all.size === before) break;
      last = next;
      offset += step;
    }
    return [...all.values()];
  }
}

/** The Prisma side of `EbizSyncStore`. */
@Injectable()
export class PrismaEbizSyncStore implements EbizSyncStore {
  async startRun(trigger: SyncRunTrigger): Promise<string> {
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.ebizSyncRun.updateMany({
          where: {
            activeKey: ACTIVE_KEY,
            status: "RUNNING",
            updatedAt: { lt: new Date(Date.now() - STALE_RUN_AFTER_MS) },
          },
          data: {
            activeKey: null,
            status: "FAILED",
            completedAt: new Date(),
            errorCode: "EBIZ_SYNC_STALE",
          },
        });
        const run = await tx.ebizSyncRun.create({
          data: { activeKey: ACTIVE_KEY, status: "RUNNING", trigger },
        });
        return run.id;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw new ConflictException("EBIZ_SYNC_ALREADY_RUNNING");
      throw error;
    }
  }

  async finishRun(id: string, counts: EbizSyncCounts): Promise<void> {
    await prisma.ebizSyncRun.update({
      where: { id },
      data: {
        ...counts,
        status: "APPLIED",
        activeKey: null,
        completedAt: new Date(),
      },
    });
  }

  async failRun(
    id: string,
    counts: EbizSyncCounts,
    errorCode: string,
  ): Promise<void> {
    await prisma.ebizSyncRun.update({
      where: { id },
      data: {
        ...counts,
        status: "FAILED",
        activeKey: null,
        completedAt: new Date(),
        errorCode,
      },
    });
  }

  async existing(externalIds: string[]) {
    const rows = await prisma.externalBillingDocument.findMany({
      where: {
        OR: [
          { source: "EBIZ", externalId: { in: externalIds } },
          { ebizExternalId: { in: externalIds } },
        ],
      },
      select: {
        id: true,
        source: true,
        externalId: true,
        ebizExternalId: true,
        pdfStorageKey: true,
        cancelled: true,
        externalPaymentStatus: true,
        grossAmount: true,
      },
    });
    return new Map(
      rows.map(({ ebizExternalId, externalId, ...row }) => [
        row.source === "EBIZ" ? externalId : ebizExternalId!,
        { ...row, grossAmount: row.grossAmount.toFixed(2) },
      ]),
    );
  }

  async szamlazzTwins(invoiceNumbers: string[]) {
    if (invoiceNumbers.length === 0) return new Map();
    const rows = await prisma.externalBillingDocument.findMany({
      where: {
        source: "SZAMLAZZ",
        ebizExternalId: null,
        documentNumber: { in: invoiceNumbers },
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, documentNumber: true, pdfStorageKey: true },
    });
    const twins = new Map<
      string,
      { id: string; pdfStorageKey: string | null }
    >();
    for (const row of rows) {
      const key = invoiceNumberKey(row.documentNumber);
      if (!twins.has(key))
        twins.set(key, { id: row.id, pdfStorageKey: row.pdfStorageKey });
    }
    return twins;
  }

  async linkEbiz(id: string, ebizExternalId: string): Promise<void> {
    await prisma.externalBillingDocument.update({
      where: { id },
      data: { ebizExternalId },
    });
  }

  async create(data: ReturnType<typeof ebizNewRow>) {
    return prisma.externalBillingDocument.create({
      data: { ...data, lines: data.lines as Prisma.InputJsonValue },
      select: { id: true },
    });
  }

  async update(id: string, data: Record<string, unknown>): Promise<void> {
    await prisma.externalBillingDocument.update({
      where: { id },
      data: data as Prisma.ExternalBillingDocumentUpdateInput,
    });
  }

  async setPdf(
    id: string,
    pdfStorageKey: string | null,
    pdfMissingReason: string | null,
  ): Promise<void> {
    await prisma.externalBillingDocument.update({
      where: { id },
      data: { pdfStorageKey, pdfMissingReason },
    });
  }
}
