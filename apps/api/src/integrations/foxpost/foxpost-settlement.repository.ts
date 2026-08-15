import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, prisma, Repository } from "@acropora/database";
import type {
  FoxpostMonthlyReportSummary,
  FoxpostSettlementDetail,
  FoxpostSettlementListResponse,
  FoxpostSettlementSummary,
  FoxpostSyncSummary,
} from "@acropora/types";

import type { FoxpostSettlementListQueryDto } from "./dto/foxpost-settlement-list-query.dto.js";
import type { BuiltFoxpostMonthlyReport } from "./foxpost-monthly-report.xlsx.js";
import type {
  ParsedFoxpostInvoicePdf,
  ParsedFoxpostSettlementXlsx,
} from "./foxpost-settlement.parser.js";

const ACTIVE_SYNC_KEY = "FOXPOST_GMAIL_SETTLEMENTS";
const STALE_RUN_AFTER_MS = 20 * 60_000;

const summaryInclude = {
  lines: { select: { status: true } },
} as const;

const detailInclude = {
  lines: {
    orderBy: { sourceRowNumber: "asc" },
    include: {
      manualApprovedBy: { select: { id: true, displayName: true } },
    },
  },
} as const;

type SettlementSummaryRow = Prisma.FoxpostSettlementGetPayload<{
  include: typeof summaryInclude;
}>;
type SettlementDetailRow = Prisma.FoxpostSettlementGetPayload<{
  include: typeof detailInclude;
}>;

function toSummary(row: SettlementSummaryRow): FoxpostSettlementSummary {
  const matchedLineCount = row.lines.filter(
    (line) => line.status === "MATCHED",
  ).length;
  return {
    id: row.id,
    gmailInternalDate: row.gmailInternalDate?.toISOString(),
    gmailSubject: row.gmailSubject ?? undefined,
    partnerCode: row.partnerCode ?? undefined,
    settlementCode: row.settlementCode ?? undefined,
    periodStart: row.periodStart?.toISOString(),
    periodEnd: row.periodEnd?.toISOString(),
    invoiceNumber: row.invoiceNumber ?? undefined,
    invoiceIssueDate: row.invoiceIssueDate?.toISOString(),
    currency: row.currency,
    collectedAmount: row.collectedAmount?.toString(),
    invoiceGrossAmount: row.invoiceGrossAmount?.toString(),
    transferredAmount: row.transferredAmount?.toString(),
    status: row.status,
    matchedLineCount,
    unresolvedLineCount: row.lines.length - matchedLineCount,
    errorCode: row.errorCode ?? undefined,
    processedAt: row.processedAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

function toDetail(row: SettlementDetailRow): FoxpostSettlementDetail {
  const matchedLineCount = row.lines.filter(
    (line) => line.status === "MATCHED",
  ).length;
  return {
    id: row.id,
    gmailMessageId: row.gmailMessageId,
    gmailInternalDate: row.gmailInternalDate?.toISOString(),
    gmailSubject: row.gmailSubject ?? undefined,
    gmailFrom: row.gmailFrom ?? undefined,
    partnerCode: row.partnerCode ?? undefined,
    settlementCode: row.settlementCode ?? undefined,
    periodStart: row.periodStart?.toISOString(),
    periodEnd: row.periodEnd?.toISOString(),
    invoiceNumber: row.invoiceNumber ?? undefined,
    invoiceIssueDate: row.invoiceIssueDate?.toISOString(),
    currency: row.currency,
    collectedAmount: row.collectedAmount?.toString(),
    invoiceGrossAmount: row.invoiceGrossAmount?.toString(),
    transferredAmount: row.transferredAmount?.toString(),
    status: row.status,
    matchedLineCount,
    unresolvedLineCount: row.lines.length - matchedLineCount,
    errorCode: row.errorCode ?? undefined,
    processedAt: row.processedAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
    xlsxFileName: row.xlsxFileName,
    pdfFileName: row.pdfFileName,
    lines: row.lines.map((line) => ({
      id: line.id,
      sourceRowNumber: line.sourceRowNumber,
      referenceCode: line.referenceCode,
      transactionDate: line.transactionDate.toISOString(),
      recipientName: line.recipientName ?? undefined,
      parcelBarcode: line.parcelBarcode ?? undefined,
      collectedAmount: line.collectedAmount.toString(),
      salesOrderId: line.salesOrderId ?? undefined,
      invoiceId: line.invoiceId ?? undefined,
      invoiceNumber: line.invoiceNumber ?? undefined,
      resolutionSource: line.resolutionSource ?? undefined,
      status: line.status,
      errorCode: line.errorCode ?? undefined,
      manualApprovedAt: line.manualApprovedAt?.toISOString(),
      manualApprovedByUserId: line.manualApprovedByUserId ?? undefined,
      manualApprovedByDisplayName:
        line.manualApprovedBy?.displayName ?? undefined,
      updatedAt: line.updatedAt.toISOString(),
    })),
  };
}

export interface FoxpostPendingMessageInput {
  gmailMessageId: string;
  gmailThreadId: string | null;
  gmailInternalDate: Date | null;
  gmailSubject: string | null;
  gmailFrom: string | null;
  xlsxAttachmentId: string;
  xlsxFileName: string;
  xlsxContent: Buffer;
  xlsxSha256: string;
  pdfAttachmentId: string;
  pdfFileName: string;
  pdfContent: Buffer;
  pdfSha256: string;
}

export interface FoxpostResolvedLineInput {
  sourceRowNumber: number;
  referenceCode: string;
  transactionDate: Date;
  recipientName: string | null;
  parcelBarcode: string | null;
  collectedAmount: number;
  salesOrderId: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  resolutionSource: "LOCAL" | "UNAS" | "MANUAL" | null;
  status: "MATCHED" | "ORDER_NOT_FOUND" | "INVOICE_NOT_FOUND";
  errorCode: string | null;
  manualApprovedByUserId?: string | null;
  manualApprovedAt?: Date | null;
}

export interface FoxpostManualLineResolution {
  sourceRowNumber: number;
  referenceCode: string;
  invoiceNumber: string;
  manualApprovedByUserId: string | null;
  manualApprovedAt: Date;
}

export interface LocalOrderResolution {
  referenceCode: string;
  salesOrderId: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
}

@Injectable()
export class FoxpostSettlementRepository extends Repository {
  constructor() {
    super(prisma);
  }

  async createRun(): Promise<string> {
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.foxpostSyncRun.updateMany({
          where: {
            activeKey: ACTIVE_SYNC_KEY,
            status: "RUNNING",
            updatedAt: { lt: new Date(Date.now() - STALE_RUN_AFTER_MS) },
          },
          data: {
            activeKey: null,
            status: "FAILED",
            completedAt: new Date(),
            errorCode: "FOXPOST_GMAIL_SYNC_STALE",
          },
        });
        const run = await tx.foxpostSyncRun.create({
          data: { activeKey: ACTIVE_SYNC_KEY, status: "RUNNING" },
        });
        return run.id;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw new ConflictException("FOXPOST_GMAIL_SYNC_ALREADY_RUNNING");
      throw error;
    }
  }

  async completeRun(
    runId: string,
    counts: Omit<FoxpostSyncSummary, "runId" | "status">,
  ): Promise<FoxpostSyncSummary> {
    await prisma.foxpostSyncRun.update({
      where: { id: runId },
      data: {
        activeKey: null,
        status: "APPLIED",
        completedAt: new Date(),
        ...counts,
      },
    });
    return { runId, status: "APPLIED", ...counts };
  }

  async failRun(runId: string, errorCode: string): Promise<void> {
    await prisma.foxpostSyncRun.updateMany({
      where: { id: runId, status: "RUNNING" },
      data: {
        activeKey: null,
        status: "FAILED",
        completedAt: new Date(),
        errorCode: errorCode.slice(0, 200),
      },
    });
  }

  async hasMessage(gmailMessageId: string): Promise<boolean> {
    return Boolean(
      await prisma.foxpostSettlement.findUnique({
        where: { gmailMessageId },
        select: { id: true },
      }),
    );
  }

  async createPending(
    input: FoxpostPendingMessageInput,
  ): Promise<string | null> {
    try {
      const row = await prisma.foxpostSettlement.create({
        data: {
          ...input,
          xlsxContent: new Uint8Array(input.xlsxContent),
          pdfContent: new Uint8Array(input.pdfContent),
          status: "PROCESSING",
        },
        select: { id: true },
      });
      return row.id;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        return null;
      throw error;
    }
  }

  async storedSource(id: string): Promise<{
    xlsx: Buffer;
    pdf: Buffer;
  }> {
    const row = await prisma.foxpostSettlement.findUnique({
      where: { id },
      select: { xlsxContent: true, pdfContent: true },
    });
    if (!row) throw new NotFoundException("FOXPOST_SETTLEMENT_NOT_FOUND");
    return {
      xlsx: Buffer.from(row.xlsxContent),
      pdf: Buffer.from(row.pdfContent),
    };
  }

  async manualLineResolutions(
    settlementId: string,
  ): Promise<FoxpostManualLineResolution[]> {
    const rows = await prisma.foxpostSettlementLine.findMany({
      where: {
        settlementId,
        resolutionSource: "MANUAL",
        invoiceNumber: { not: null },
        manualApprovedAt: { not: null },
      },
      select: {
        sourceRowNumber: true,
        referenceCode: true,
        invoiceNumber: true,
        manualApprovedByUserId: true,
        manualApprovedAt: true,
      },
    });
    return rows.flatMap((row) =>
      row.invoiceNumber && row.manualApprovedAt
        ? [
            {
              sourceRowNumber: row.sourceRowNumber,
              referenceCode: row.referenceCode,
              invoiceNumber: row.invoiceNumber,
              manualApprovedByUserId: row.manualApprovedByUserId,
              manualApprovedAt: row.manualApprovedAt,
            },
          ]
        : [],
    );
  }

  async saveProcessingResult(
    id: string,
    xlsx: ParsedFoxpostSettlementXlsx,
    pdf: ParsedFoxpostInvoicePdf,
    lines: readonly FoxpostResolvedLineInput[],
  ): Promise<void> {
    const completed = lines.every((line) => line.status === "MATCHED");
    await prisma.$transaction(async (tx) => {
      await tx.foxpostSettlementLine.deleteMany({
        where: { settlementId: id },
      });
      await tx.foxpostSettlement.update({
        where: { id },
        data: {
          partnerCode: xlsx.partnerCode,
          settlementCode: xlsx.settlementCode,
          periodStart: xlsx.periodStart,
          periodEnd: xlsx.periodEnd,
          invoiceNumber: pdf.invoiceNumber,
          invoiceIssueDate: pdf.invoiceIssueDate,
          currency: pdf.currency,
          collectedAmount: new Prisma.Decimal(xlsx.collectedAmount),
          invoiceGrossAmount: new Prisma.Decimal(pdf.invoiceGrossAmount),
          transferredAmount: new Prisma.Decimal(xlsx.transferredAmount),
          status: completed ? "COMPLETED" : "NEEDS_REVIEW",
          errorCode: completed ? null : "FOXPOST_ORDER_INVOICE_REVIEW_REQUIRED",
          processedAt: new Date(),
          lines: {
            create: lines.map((line) => ({
              ...line,
              collectedAmount: new Prisma.Decimal(line.collectedAmount),
            })),
          },
        },
      });
    });
  }

  async markError(id: string, errorCode: string): Promise<void> {
    await prisma.foxpostSettlement.updateMany({
      where: { id },
      data: {
        status: "ERROR",
        errorCode: errorCode.slice(0, 200),
        processedAt: new Date(),
      },
    });
  }

  async resolveLocal(
    referenceCodes: readonly string[],
  ): Promise<LocalOrderResolution[]> {
    if (!referenceCodes.length) return [];
    const references = await prisma.externalReference.findMany({
      where: {
        system: "UNAS",
        entityType: "SalesOrder",
        externalKey: { in: [...new Set(referenceCodes)] },
      },
      select: { entityId: true, externalKey: true },
    });
    const orders = await prisma.salesOrder.findMany({
      where: { id: { in: references.map((reference) => reference.entityId) } },
      select: {
        id: true,
        invoices: {
          where: { source: "UNAS" },
          select: { id: true, invoiceNumber: true },
          orderBy: { createdAt: "desc" },
        },
      },
    });
    const orderById = new Map(orders.map((order) => [order.id, order]));
    return references.flatMap((reference) => {
      if (!reference.externalKey) return [];
      const order = orderById.get(reference.entityId);
      if (!order) return [];
      return [
        {
          referenceCode: reference.externalKey,
          salesOrderId: order.id,
          invoiceId: order.invoices[0]?.id ?? null,
          invoiceNumber: order.invoices[0]?.invoiceNumber ?? null,
        },
      ];
    });
  }

  async list(
    query: FoxpostSettlementListQueryDto,
  ): Promise<FoxpostSettlementListResponse> {
    const where: Prisma.FoxpostSettlementWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.year && query.month
        ? {
            invoiceIssueDate: {
              gte: new Date(Date.UTC(query.year, query.month - 1, 1)),
              lt: new Date(Date.UTC(query.year, query.month, 1)),
            },
          }
        : {}),
    };
    const [rows, totalItems] = await Promise.all([
      prisma.foxpostSettlement.findMany({
        where,
        include: summaryInclude,
        orderBy: [
          { invoiceIssueDate: { sort: "desc", nulls: "last" } },
          { createdAt: "desc" },
        ],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.foxpostSettlement.count({ where }),
    ]);
    return {
      items: rows.map(toSummary),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / query.pageSize),
      },
    };
  }

  async detail(id: string): Promise<FoxpostSettlementDetail> {
    const row = await prisma.foxpostSettlement.findUnique({
      where: { id },
      include: detailInclude,
    });
    if (!row) throw new NotFoundException("FOXPOST_SETTLEMENT_NOT_FOUND");
    return toDetail(row);
  }

  async approveLine(input: {
    settlementId: string;
    lineId: string;
    invoiceNumber: string;
    expectedUpdatedAt: Date;
    actorUserId: string;
  }): Promise<{ year: number; month: number }> {
    return prisma.$transaction(async (tx) => {
      const line = await tx.foxpostSettlementLine.findFirst({
        where: { id: input.lineId, settlementId: input.settlementId },
        select: {
          id: true,
          sourceRowNumber: true,
          referenceCode: true,
          invoiceNumber: true,
          status: true,
          updatedAt: true,
          settlement: {
            select: {
              gmailMessageId: true,
              invoiceIssueDate: true,
            },
          },
        },
      });
      if (!line)
        throw new NotFoundException("FOXPOST_SETTLEMENT_LINE_NOT_FOUND");
      if (line.updatedAt.getTime() !== input.expectedUpdatedAt.getTime())
        throw new ConflictException("FOXPOST_SETTLEMENT_LINE_CHANGED");
      if (!line.settlement.invoiceIssueDate)
        throw new ConflictException("FOXPOST_SETTLEMENT_NOT_PROCESSED");

      const updated = await tx.foxpostSettlementLine.updateMany({
        where: {
          id: input.lineId,
          settlementId: input.settlementId,
          updatedAt: input.expectedUpdatedAt,
        },
        data: {
          salesOrderId: null,
          invoiceId: null,
          invoiceNumber: input.invoiceNumber,
          resolutionSource: "MANUAL",
          status: "MATCHED",
          errorCode: null,
          manualApprovedByUserId: input.actorUserId,
          manualApprovedAt: new Date(),
        },
      });
      if (updated.count !== 1)
        throw new ConflictException("FOXPOST_SETTLEMENT_LINE_CHANGED");

      const unresolvedLineCount = await tx.foxpostSettlementLine.count({
        where: {
          settlementId: input.settlementId,
          status: { not: "MATCHED" },
        },
      });
      await tx.foxpostSettlement.update({
        where: { id: input.settlementId },
        data: {
          status: unresolvedLineCount ? "NEEDS_REVIEW" : "COMPLETED",
          errorCode: unresolvedLineCount
            ? "FOXPOST_ORDER_INVOICE_REVIEW_REQUIRED"
            : null,
          processedAt: new Date(),
        },
      });
      await tx.auditLog.create({
        data: {
          userId: input.actorUserId,
          action: "FOXPOST_SETTLEMENT_LINE_MANUALLY_APPROVED",
          entityType: "FoxpostSettlement",
          entityId: input.settlementId,
          metadata: {
            settlementId: input.settlementId,
            settlementLineId: input.lineId,
            gmailMessageId: line.settlement.gmailMessageId,
            sourceRowNumber: line.sourceRowNumber,
            referenceCode: line.referenceCode,
            previousInvoiceNumber: line.invoiceNumber,
            previousStatus: line.status,
            approvedInvoiceNumber: input.invoiceNumber,
          },
        },
      });
      return {
        year: line.settlement.invoiceIssueDate.getUTCFullYear(),
        month: line.settlement.invoiceIssueDate.getUTCMonth() + 1,
      };
    });
  }

  async reportSource(year: number, month: number) {
    const rows = await prisma.foxpostSettlement.findMany({
      where: {
        status: { in: ["COMPLETED", "NEEDS_REVIEW"] },
        invoiceIssueDate: {
          gte: new Date(Date.UTC(year, month - 1, 1)),
          lt: new Date(Date.UTC(year, month, 1)),
        },
      },
      select: {
        invoiceIssueDate: true,
        settlementCode: true,
        invoiceNumber: true,
        collectedAmount: true,
        invoiceGrossAmount: true,
        transferredAmount: true,
        gmailMessageId: true,
        gmailSubject: true,
        lines: {
          select: {
            sourceRowNumber: true,
            referenceCode: true,
            transactionDate: true,
            recipientName: true,
            parcelBarcode: true,
            collectedAmount: true,
            invoiceNumber: true,
            status: true,
            errorCode: true,
          },
          orderBy: { sourceRowNumber: "asc" },
        },
      },
      orderBy: [{ invoiceIssueDate: "asc" }, { settlementCode: "asc" }],
    });
    return rows.map((row) => ({
      invoiceIssueDate: row.invoiceIssueDate!,
      settlementCode: row.settlementCode!,
      foxpostInvoiceNumber: row.invoiceNumber!,
      collectedAmount: row.collectedAmount!.toNumber(),
      invoiceGrossAmount: row.invoiceGrossAmount!.toNumber(),
      transferredAmount: row.transferredAmount!.toNumber(),
      invoiceNumbers: row.lines.flatMap((line) =>
        line.status === "MATCHED" && line.invoiceNumber
          ? [line.invoiceNumber]
          : [],
      ),
      unresolvedLines: row.lines.flatMap((line) =>
        line.status !== "MATCHED"
          ? [
              {
                gmailMessageId: row.gmailMessageId,
                gmailSubject: row.gmailSubject,
                sourceRowNumber: line.sourceRowNumber,
                referenceCode: line.referenceCode,
                transactionDate: line.transactionDate,
                recipientName: line.recipientName,
                parcelBarcode: line.parcelBarcode,
                collectedAmount: line.collectedAmount.toNumber(),
                status: line.status,
                errorCode: line.errorCode,
              },
            ]
          : [],
      ),
    }));
  }

  async saveReport(
    year: number,
    month: number,
    report: BuiltFoxpostMonthlyReport,
  ): Promise<void> {
    const data = {
      filename: report.filename,
      content: new Uint8Array(report.buffer),
      settlementCount: report.settlementCount,
      invoiceCount: report.invoiceCount,
      collectedAmount: new Prisma.Decimal(report.collectedAmount),
      invoiceGrossAmount: new Prisma.Decimal(report.invoiceGrossAmount),
      transferredAmount: new Prisma.Decimal(report.transferredAmount),
      generatedAt: new Date(),
    };
    await prisma.foxpostMonthlyReport.upsert({
      where: { year_month: { year, month } },
      create: { year, month, ...data },
      update: data,
    });
  }

  async listReports(): Promise<FoxpostMonthlyReportSummary[]> {
    const reports = await prisma.foxpostMonthlyReport.findMany({
      orderBy: [{ year: "desc" }, { month: "desc" }],
    });
    return Promise.all(
      reports.map(async (report) => ({
        id: report.id,
        year: report.year,
        month: report.month,
        filename: report.filename,
        settlementCount: report.settlementCount,
        invoiceCount: report.invoiceCount,
        collectedAmount: report.collectedAmount.toString(),
        invoiceGrossAmount: report.invoiceGrossAmount.toString(),
        transferredAmount: report.transferredAmount.toString(),
        generatedAt: report.generatedAt.toISOString(),
        blockedByUnresolvedSettlements: await this.unresolvedForMonth(
          report.year,
          report.month,
        ),
        unresolvedLineCount: await this.unresolvedLinesForMonth(
          report.year,
          report.month,
        ),
      })),
    );
  }

  async downloadReport(
    year: number,
    month: number,
  ): Promise<{ filename: string; buffer: Buffer }> {
    const report = await prisma.foxpostMonthlyReport.findUnique({
      where: { year_month: { year, month } },
      select: { filename: true, content: true },
    });
    if (!report)
      throw new NotFoundException("FOXPOST_MONTHLY_REPORT_NOT_FOUND");
    return { filename: report.filename, buffer: Buffer.from(report.content) };
  }

  private unresolvedForMonth(year: number, month: number): Promise<number> {
    return prisma.foxpostSettlement.count({
      where: {
        status: { in: ["PROCESSING", "NEEDS_REVIEW", "ERROR"] },
        invoiceIssueDate: {
          gte: new Date(Date.UTC(year, month - 1, 1)),
          lt: new Date(Date.UTC(year, month, 1)),
        },
      },
    });
  }

  private unresolvedLinesForMonth(
    year: number,
    month: number,
  ): Promise<number> {
    return prisma.foxpostSettlementLine.count({
      where: {
        status: { not: "MATCHED" },
        settlement: {
          invoiceIssueDate: {
            gte: new Date(Date.UTC(year, month - 1, 1)),
            lt: new Date(Date.UTC(year, month, 1)),
          },
        },
      },
    });
  }
}
