import { Prisma, prisma } from "@acropora/database";
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  SimplePayLineError,
  SimplePayReportDetail,
  SimplePayReportListResponse,
  SimplePayReportSummary,
  SimplePayTransactionLine,
} from "@acropora/types";

import type { SimplePayReport } from "./simplepay-report.parser.js";
import type {
  SimplePayLineResolution,
  SimplePayOrderCandidate,
} from "./simplepay-resolution.js";

export interface StoredSimplePaySource {
  fileName: string;
  sha256: string;
  content: Buffer;
  uploadedByUserId: string | null;
  gmailMessageId: string | null;
}

export interface SimplePayReportFacts {
  /** yyyy-MM-dd, each */
  reportDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  warnings: string[];
}

export interface UnresolvedSimplePayLine {
  id: string;
  reportId: string;
  orderKeySuffix: string | null;
  amount: Prisma.Decimal;
}

function day(value: string | null): Date | null {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

function isoDay(value: Date | null): string | undefined {
  return value ? value.toISOString().slice(0, 10) : undefined;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

/**
 * The same report can arrive again with other bytes (a forwarded mail, a
 * re-export), so it is also known by what it says: its day and every
 * transaction with its amount. An empty week is known by its day.
 */
export function simplePayContentKey(
  report: SimplePayReport,
  reportDate: string | null,
): string {
  return [
    reportDate ?? "",
    report.currency,
    ...report.transactions
      .map((row) => `${row.simplePayTransactionId}:${row.amount.toFixed(2)}`)
      .sort(),
  ].join("|");
}

@Injectable()
export class SimplePaySettlementRepository {
  /** A new report, or the id of the one already stored (`duplicate`). */
  async createReport(
    source: StoredSimplePaySource,
    report: SimplePayReport,
    facts: SimplePayReportFacts,
  ): Promise<{ id: string; duplicate: boolean }> {
    const contentKey = simplePayContentKey(report, facts.reportDate);
    try {
      const created = await prisma.simplePayReport.create({
        data: {
          fileName: source.fileName,
          sha256: source.sha256,
          content: new Uint8Array(source.content),
          contentKey,
          reportDate: day(facts.reportDate),
          periodStart: day(facts.periodStart),
          periodEnd: day(facts.periodEnd),
          currency: report.currency,
          amountTotal: report.amountTotal,
          commissionTotal: report.commissionTotal,
          netTotal: report.netTotal,
          lineCount: report.transactions.length,
          warnings: facts.warnings,
          status: report.transactions.length ? "NEEDS_REVIEW" : "COMPLETED",
          gmailMessageId: source.gmailMessageId,
          uploadedByUserId: source.uploadedByUserId,
          lines: {
            create: report.transactions.map((row) => ({
              rowNumber: row.rowNumber,
              transactionStatus: row.status,
              simplePayTransactionId: row.simplePayTransactionId,
              merchantTransactionId: row.merchantTransactionId,
              orderKeySuffix: row.orderKeySuffix,
              transactionAt: row.transactionAt,
              transactionDate: day(row.transactionAt.slice(0, 10))!,
              currency: row.currency,
              amount: row.amount,
              commission: row.commission,
              netAmount: row.netAmount,
              interchangeFee: row.interchangeFee,
              schemeFee: row.schemeFee,
              merchantFee: row.merchantFee,
              invoiceNumbers: [],
              status: "NEEDS_REVIEW" as const,
            })),
          },
        },
        select: { id: true },
      });
      return { id: created.id, duplicate: false };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const existing = await prisma.simplePayReport.findFirst({
        where: {
          OR: [
            { sha256: source.sha256 },
            { contentKey },
            ...(source.gmailMessageId
              ? [{ gmailMessageId: source.gmailMessageId }]
              : []),
            {
              lines: {
                some: {
                  simplePayTransactionId: {
                    in: report.transactions.map(
                      (row) => row.simplePayTransactionId,
                    ),
                  },
                },
              },
            },
          ],
        },
        select: { id: true },
      });
      if (!existing) throw error;
      return { id: existing.id, duplicate: true };
    }
  }

  /** Lines a person has not decided. */
  unresolvedLines(reportId: string): Promise<UnresolvedSimplePayLine[]> {
    return prisma.simplePayTransactionLine.findMany({
      where: { reportId, status: "NEEDS_REVIEW", manualApprovedAt: null },
      select: { id: true, reportId: true, orderKeySuffix: true, amount: true },
    });
  }

  /**
   * Order key end -> the webshop orders ending in it, with their outgoing
   * invoice numbers. The order number is "UNAS-<key>" (unas-order-sync), and
   * the key ends in the six digits after the "T" of the merchant ID.
   */
  async orderCandidates(
    suffixes: readonly string[],
  ): Promise<Map<string, SimplePayOrderCandidate[]>> {
    const unique = [...new Set(suffixes)];
    if (unique.length === 0) return new Map();
    const orders = await prisma.salesOrder.findMany({
      where: {
        orderNumber: { startsWith: "UNAS-" },
        OR: unique.map((suffix) => ({
          orderNumber: { endsWith: `-${suffix}` },
        })),
      },
      select: {
        orderNumber: true,
        totalGross: true,
        invoices: {
          where: { direction: "OUTBOUND", invoiceNumber: { not: null } },
          select: { invoiceNumber: true },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    const out = new Map<string, SimplePayOrderCandidate[]>();
    for (const order of orders) {
      const suffix = order.orderNumber.slice(
        order.orderNumber.lastIndexOf("-") + 1,
      );
      out.set(suffix, [
        ...(out.get(suffix) ?? []),
        {
          orderNumber: order.orderNumber,
          totalGross: Number(order.totalGross),
          invoiceNumbers: order.invoices.map(
            (invoice) => invoice.invoiceNumber!,
          ),
        },
      ]);
    }
    return out;
  }

  async saveResolutions(
    resolutions: ReadonlyArray<{
      lineId: string;
      resolution: SimplePayLineResolution;
    }>,
  ): Promise<void> {
    await prisma.$transaction(
      resolutions.map(({ lineId, resolution }) =>
        prisma.simplePayTransactionLine.updateMany({
          // a person's decision is never overwritten
          where: { id: lineId, manualApprovedAt: null },
          data:
            resolution.status === "RESOLVED"
              ? {
                  status: "RESOLVED",
                  resolutionSource: "ORDER_KEY",
                  orderNumber: resolution.orderNumber,
                  orderTotal: resolution.orderTotal,
                  invoiceNumbers: resolution.invoiceNumbers,
                  errorCode: null,
                }
              : {
                  status: "NEEDS_REVIEW",
                  resolutionSource: null,
                  orderNumber: resolution.orderNumber,
                  orderTotal: resolution.orderTotal,
                  invoiceNumbers: [],
                  errorCode: resolution.errorCode,
                },
        }),
      ),
    );
  }

  /** A report is COMPLETED when none of its lines needs review. */
  async refreshReportStatus(reportIds: readonly string[]): Promise<void> {
    for (const id of new Set(reportIds)) {
      const open = await prisma.simplePayTransactionLine.count({
        where: { reportId: id, status: "NEEDS_REVIEW" },
      });
      await prisma.simplePayReport.update({
        where: { id },
        data: { status: open === 0 ? "COMPLETED" : "NEEDS_REVIEW" },
      });
    }
  }

  async approveLine(input: {
    reportId: string;
    lineId: string;
    invoiceNumber: string;
    expectedUpdatedAt: Date;
    actorUserId: string;
  }): Promise<void> {
    const updated = await prisma.simplePayTransactionLine.updateMany({
      where: {
        id: input.lineId,
        reportId: input.reportId,
        updatedAt: input.expectedUpdatedAt,
      },
      data: {
        status: "RESOLVED",
        resolutionSource: "MANUAL",
        invoiceNumbers: [input.invoiceNumber],
        errorCode: null,
        manualApprovedByUserId: input.actorUserId,
        manualApprovedAt: new Date(),
      },
    });
    if (updated.count === 0) {
      const exists = await prisma.simplePayTransactionLine.findFirst({
        where: { id: input.lineId, reportId: input.reportId },
        select: { id: true },
      });
      if (!exists) throw new NotFoundException("SIMPLEPAY_LINE_NOT_FOUND");
      throw new ConflictException("SIMPLEPAY_LINE_CHANGED");
    }
  }

  async listReports(query: {
    status?: "COMPLETED" | "NEEDS_REVIEW";
    page: number;
    pageSize: number;
  }): Promise<SimplePayReportListResponse> {
    const where = query.status ? { status: query.status } : {};
    const [total, reports] = await Promise.all([
      prisma.simplePayReport.count({ where }),
      prisma.simplePayReport.findMany({
        where,
        orderBy: [{ reportDate: "desc" }, { createdAt: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          ...summarySelect,
          _count: { select: { lines: { where: { status: "RESOLVED" } } } },
        },
      }),
    ]);
    return {
      items: reports.map((report) => summary(report)),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        totalItems: total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    };
  }

  async reportDetail(id: string): Promise<SimplePayReportDetail> {
    const report = await prisma.simplePayReport.findUnique({
      where: { id },
      select: {
        ...summarySelect,
        _count: { select: { lines: { where: { status: "RESOLVED" } } } },
        lines: {
          orderBy: { rowNumber: "asc" },
          include: { manualApprovedBy: { select: { displayName: true } } },
        },
      },
    });
    if (!report) throw new NotFoundException("SIMPLEPAY_REPORT_NOT_FOUND");
    return {
      ...summary(report),
      lines: report.lines.map((line): SimplePayTransactionLine => ({
        id: line.id,
        rowNumber: line.rowNumber,
        transactionStatus: line.transactionStatus,
        simplePayTransactionId: line.simplePayTransactionId,
        merchantTransactionId: line.merchantTransactionId,
        transactionAt: line.transactionAt,
        amount: line.amount.toString(),
        commission: line.commission.toString(),
        netAmount: line.netAmount.toString(),
        orderNumber: line.orderNumber ?? undefined,
        orderTotal: line.orderTotal?.toString(),
        invoiceNumbers: line.invoiceNumbers,
        status: line.status,
        resolutionSource: line.resolutionSource ?? undefined,
        errorCode: (line.errorCode as SimplePayLineError | null) ?? undefined,
        manualApprovedAt: line.manualApprovedAt?.toISOString(),
        manualApprovedByDisplayName:
          line.manualApprovedBy?.displayName ?? undefined,
        updatedAt: line.updatedAt.toISOString(),
      })),
    };
  }
}

const summarySelect = {
  id: true,
  fileName: true,
  reportDate: true,
  periodStart: true,
  periodEnd: true,
  currency: true,
  amountTotal: true,
  commissionTotal: true,
  netTotal: true,
  lineCount: true,
  status: true,
  warnings: true,
  createdAt: true,
} as const;

function summary(report: {
  id: string;
  fileName: string;
  reportDate: Date | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  currency: string;
  amountTotal: Prisma.Decimal;
  commissionTotal: Prisma.Decimal;
  netTotal: Prisma.Decimal;
  lineCount: number;
  status: "COMPLETED" | "NEEDS_REVIEW";
  warnings: string[];
  createdAt: Date;
  _count: { lines: number };
}): SimplePayReportSummary {
  return {
    id: report.id,
    fileName: report.fileName,
    reportDate: isoDay(report.reportDate),
    periodStart: isoDay(report.periodStart),
    periodEnd: isoDay(report.periodEnd),
    currency: report.currency,
    amountTotal: report.amountTotal.toString(),
    commissionTotal: report.commissionTotal.toString(),
    netTotal: report.netTotal.toString(),
    lineCount: report.lineCount,
    resolvedLineCount: report._count.lines,
    status: report.status,
    warnings: report.warnings,
    createdAt: report.createdAt.toISOString(),
  };
}
