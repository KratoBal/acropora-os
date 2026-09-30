import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, prisma, Repository } from "@acropora/database";
import type {
  NavIncomingInvoiceListResponse,
  NavInvoiceSyncRun,
} from "@acropora/types";

import type { NavInvoiceDigestItem } from "../../integrations/nav/nav-online-invoice.client.js";
import type { NavIncomingInvoiceListQueryDto } from "./dto/nav-incoming-invoice-list-query.dto.js";
import {
  hungarianTaxBase,
  toNavIncomingInvoiceSummary,
  type NavIncomingInvoiceRow,
  type StoredNavInvoiceParsedData,
} from "./nav-incoming-invoice.types.js";

const PROVIDER = "NAV";
const STREAM = "INBOUND_INVOICES";
const ACTIVE_SYNC_KEY = "NAV_INBOUND_INVOICES";
const STALE_RUN_AFTER_MS = 15 * 60_000;

function toRunView(run: {
  id: string;
  status: string;
  windowStart: Date | null;
  windowEnd: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  invoicesSeen: number;
  createdCount: number;
  skippedCount: number;
  errorCode: string | null;
}): NavInvoiceSyncRun {
  return {
    id: run.id,
    status: run.status as NavInvoiceSyncRun["status"],
    windowStart: run.windowStart?.toISOString() ?? null,
    windowEnd: run.windowEnd.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null,
    invoicesSeen: run.invoicesSeen,
    createdCount: run.createdCount,
    skippedCount: run.skippedCount,
    errorCode: run.errorCode,
  };
}

export interface NavInvoiceSyncApplyResult {
  runId: string;
  status: "APPLIED";
  invoicesSeen: number;
  createdCount: number;
  skippedCount: number;
  windowStart: string | null;
  windowEnd: string;
}

@Injectable()
export class NavIncomingInvoiceRepository extends Repository {
  constructor() {
    super(prisma);
  }

  async getCursor(): Promise<Date | null> {
    const cursor = await prisma.integrationCursor.findUnique({
      where: { provider_stream: { provider: PROVIDER, stream: STREAM } },
    });
    return cursor?.lastSuccessfulWindowEnd ?? null;
  }

  async createRun(input: {
    windowStart: Date | null;
    windowEnd: Date;
  }): Promise<string> {
    try {
      const run = await prisma.$transaction(async (tx) => {
        await tx.navInvoiceSyncRun.updateMany({
          where: {
            activeKey: ACTIVE_SYNC_KEY,
            status: "RUNNING",
            updatedAt: { lt: new Date(Date.now() - STALE_RUN_AFTER_MS) },
          },
          data: {
            activeKey: null,
            status: "FAILED",
            completedAt: new Date(),
            errorCode: "NAV_INVOICE_SYNC_STALE",
          },
        });
        return tx.navInvoiceSyncRun.create({
          data: {
            ...input,
            activeKey: ACTIVE_SYNC_KEY,
            status: "RUNNING",
            startedAt: new Date(),
          },
        });
      });
      return run.id;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw new ConflictException("NAV_INVOICE_SYNC_ALREADY_RUNNING");
      throw error;
    }
  }

  async markFailed(runId: string, errorCode: string): Promise<void> {
    await prisma.navInvoiceSyncRun.updateMany({
      where: { id: runId, status: "RUNNING" },
      data: {
        activeKey: null,
        status: "FAILED",
        completedAt: new Date(),
        errorCode: errorCode.slice(0, 200),
      },
    });
  }

  async getRun(runId: string): Promise<NavInvoiceSyncRun> {
    const run = await prisma.navInvoiceSyncRun.findUnique({
      where: { id: runId },
    });
    if (!run) throw new NotFoundException("NAV_INVOICE_SYNC_RUN_NOT_FOUND");
    return toRunView(run);
  }

  async listRuns(limit: number): Promise<NavInvoiceSyncRun[]> {
    const runs = await prisma.navInvoiceSyncRun.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
    });
    return runs.map(toRunView);
  }

  /// Idempotensen alkalmazza egy digest-lekérdezés eredményét: a MODIFY/STORNO
  /// műveletű digest-tételeket v1-ben szándékosan kihagyjuk (lásd
  /// docs/CURRENT_STATUS.md), CREATE tételnél pedig csak akkor jön létre új
  /// NavIncomingInvoice sor, ha (navInvoiceNumber, supplierTaxNumber) még
  /// ismeretlen - egy már ismert (esetleg már bevételezett) sort nem írunk
  /// felül, nehogy egy átfedő ablak visszaállítsa NEW állapotba.
  async applyDigest(
    runId: string,
    items: readonly NavInvoiceDigestItem[],
    windowStart: Date | null,
    windowEnd: Date,
    /**
     * A visszatöltő (`backfill`) régebbi ablakot tölt be: ott a kurzor nem
     * mozdulhat, különben a napi szinkron a régi ablakról folytatná.
     */
    options: { moveCursor?: boolean } = {},
  ): Promise<NavInvoiceSyncApplyResult> {
    return prisma.$transaction(
      async (tx) => {
        const run = await tx.navInvoiceSyncRun.findUniqueOrThrow({
          where: { id: runId },
        });
        if (run.status !== "RUNNING")
          throw new Error(`INVALID_NAV_INVOICE_SYNC_RUN_STATE:${run.status}`);

        let createdCount = 0;
        let skippedCount = 0;

        for (const item of items) {
          if (item.invoiceOperation !== "CREATE" || !item.supplierTaxNumber) {
            skippedCount += 1;
            continue;
          }
          const existing = await tx.navIncomingInvoice.findUnique({
            where: {
              navInvoiceNumber_supplierTaxNumber: {
                navInvoiceNumber: item.invoiceNumber,
                supplierTaxNumber: item.supplierTaxNumber,
              },
            },
            select: { id: true },
          });
          if (existing) {
            skippedCount += 1;
            continue;
          }
          await tx.navIncomingInvoice.create({
            data: {
              navInvoiceNumber: item.invoiceNumber,
              supplierTaxNumber: item.supplierTaxNumber,
              supplierName: item.supplierName ?? item.supplierTaxNumber,
              invoiceIssueDate: new Date(item.invoiceIssueDate),
              invoiceDeliveryDate: item.invoiceDeliveryDate
                ? new Date(item.invoiceDeliveryDate)
                : null,
              paymentDate: item.paymentDate ? new Date(item.paymentDate) : null,
              currency: item.currency ?? "HUF",
              invoiceNetAmount: item.invoiceNetAmount
                ? new Prisma.Decimal(item.invoiceNetAmount)
                : null,
              invoiceVatAmount: item.invoiceVatAmount
                ? new Prisma.Decimal(item.invoiceVatAmount)
                : null,
              insDate: new Date(item.insDate),
              status: "NEW",
            },
          });
          createdCount += 1;
        }

        if (options.moveCursor !== false)
          await tx.integrationCursor.upsert({
            where: { provider_stream: { provider: PROVIDER, stream: STREAM } },
            create: {
              provider: PROVIDER,
              stream: STREAM,
              lastSuccessfulWindowEnd: windowEnd,
            },
            update: { lastSuccessfulWindowEnd: windowEnd },
          });
        await tx.navInvoiceSyncRun.update({
          where: { id: runId },
          data: {
            activeKey: null,
            status: "APPLIED",
            completedAt: new Date(),
            invoicesSeen: items.length,
            createdCount,
            skippedCount,
          },
        });

        return {
          runId,
          status: "APPLIED" as const,
          invoicesSeen: items.length,
          createdCount,
          skippedCount,
          windowStart: windowStart?.toISOString() ?? null,
          windowEnd: windowEnd.toISOString(),
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 60_000,
      },
    );
  }

  /**
   * A SZÁRAZ VISSZATÖLTÉS SZÁMLÁLÓJA: egy digest-lista CREATE tételei közül
   * hány ismert már. Csak olvas; a beírás ugyanezt a kulcsot használja.
   */
  async countKnown(items: readonly NavInvoiceDigestItem[]): Promise<number> {
    const keys = items.filter(
      (item) => item.invoiceOperation === "CREATE" && item.supplierTaxNumber,
    );
    if (keys.length === 0) return 0;
    return prisma.navIncomingInvoice.count({
      where: {
        OR: keys.map((item) => ({
          navInvoiceNumber: item.invoiceNumber,
          supplierTaxNumber: item.supplierTaxNumber!,
        })),
      },
    });
  }

  async list(
    query: NavIncomingInvoiceListQueryDto,
  ): Promise<NavIncomingInvoiceListResponse> {
    const where: Prisma.NavIncomingInvoiceWhereInput = query.status
      ? { status: query.status }
      : {};
    const [rows, totalItems] = await Promise.all([
      prisma.navIncomingInvoice.findMany({
        where,
        orderBy: [{ insDate: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.navIncomingInvoice.count({ where }),
    ]);
    return {
      items: (rows as NavIncomingInvoiceRow[]).map(toNavIncomingInvoiceSummary),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / query.pageSize),
      },
    };
  }

  async findById(id: string): Promise<NavIncomingInvoiceRow | null> {
    const row = await prisma.navIncomingInvoice.findUnique({ where: { id } });
    return row as NavIncomingInvoiceRow | null;
  }

  /**
   * The supplier whose tax number has this tax base (first 8 digits), when
   * exactly one non-deleted supplier does. Every supplier is read and matched
   * here, not in the query: the stored forms differ (`14116380`,
   * `14116380-2-06`, `HU14116380`), and a prefix match in SQL would miss the
   * community form. Two matches are no answer: the person picks.
   */
  async supplierIdByTaxBase(taxBase: string): Promise<string | null> {
    const suppliers = await prisma.supplier.findMany({
      where: { deletedAt: null, taxNumber: { not: null } },
      select: { id: true, taxNumber: true },
    });
    const matches = suppliers.filter(
      (supplier) => hungarianTaxBase(supplier.taxNumber) === taxBase,
    );
    return matches.length === 1 ? matches[0]!.id : null;
  }

  async saveParsedData(
    id: string,
    parsedData: StoredNavInvoiceParsedData,
  ): Promise<void> {
    await prisma.navIncomingInvoice.update({
      where: { id },
      data: {
        status: "DATA_FETCHED",
        parsedData: parsedData as unknown as Prisma.InputJsonValue,
        errorCode: null,
        // A NAV számla saját adatai (beszállító neve/adószáma, összegek) a
        // teljes lekérdezés (queryInvoiceData) után pontosabbak lehetnek,
        // mint a digest-ben szereplő kivonat - a lista nézet konzisztenciája
        // miatt ilyenkor frissítjük is őket.
        supplierName: parsedData.supplierName || undefined,
        supplierTaxNumber: parsedData.supplierTaxNumber || undefined,
        currency: parsedData.currency || undefined,
      },
    });
  }

  async markError(id: string, errorCode: string): Promise<void> {
    await prisma.navIncomingInvoice.update({
      where: { id },
      data: { status: "ERROR", errorCode: errorCode.slice(0, 200) },
    });
  }
}
