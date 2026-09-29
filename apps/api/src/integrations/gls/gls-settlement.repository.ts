import { Prisma, prisma } from "@acropora/database";
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  GlsCodLineError,
  GlsCodReportDetail,
  GlsCodReportLine,
  GlsCodReportListResponse,
  GlsCodReportSummary,
  GlsInvoiceSummary,
} from "@acropora/types";

import type { GlsLineResolution } from "./gls-cod-resolution.js";
import type { GlsCompensation } from "./gls-compensation.parser.js";
import type {
  GlsCodReport,
  GlsInvoiceAttachment,
} from "./gls-documents.parser.js";

export interface StoredSource {
  fileName: string;
  sha256: string;
  content: Buffer;
  uploadedByUserId: string | null;
}

export interface UnresolvedLine {
  id: string;
  reportId: string;
  parcelNumber: string;
  codReference: string | null;
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
 * The same report can arrive twice with different bytes (measured once,
 * 2022-03-24), so a report is also known by what it says: its transfer day
 * and every parcel with its amount.
 */
export function codReportContentKey(report: GlsCodReport): string {
  return [
    report.transferDate,
    report.currency,
    ...report.lines
      .map((line) => `${line.parcelNumber}:${line.amount.toFixed(2)}`)
      .sort(),
  ].join("|");
}

@Injectable()
export class GlsSettlementRepository {
  /** A new report, or the id of the one already stored (`duplicate`). */
  async createCodReport(
    source: StoredSource,
    report: GlsCodReport,
  ): Promise<{ id: string; duplicate: boolean }> {
    const contentKey = codReportContentKey(report);
    try {
      const created = await prisma.glsCodReport.create({
        data: {
          fileName: source.fileName,
          sha256: source.sha256,
          content: new Uint8Array(source.content),
          contentKey,
          transferDate: day(report.transferDate)!,
          currency: report.currency,
          total: report.total,
          lineCount: report.lines.length,
          status: "NEEDS_REVIEW",
          uploadedByUserId: source.uploadedByUserId,
          lines: {
            create: report.lines.map((line) => ({
              rowNumber: line.rowNumber,
              reportNumber: line.reportNumber,
              parcelNumber: line.parcelNumber,
              codReference: line.codReference,
              deliveryDate: day(line.deliveryDate),
              amount: line.amount,
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
      const existing = await prisma.glsCodReport.findFirst({
        where: { OR: [{ sha256: source.sha256 }, { contentKey }] },
        select: { id: true },
      });
      if (!existing) throw error;
      return { id: existing.id, duplicate: true };
    }
  }

  async createInvoice(
    source: StoredSource,
    attachment: GlsInvoiceAttachment,
  ): Promise<{ id: string; duplicate: boolean }> {
    try {
      const created = await prisma.glsInvoice.create({
        data: {
          invoiceNumber: attachment.invoiceNumber,
          invoiceDate: day(attachment.invoiceDate),
          currency: attachment.currency,
          feeTotal: attachment.feeTotal,
          cardFeeTotal: attachment.cardFeeTotal,
          parcelCount: attachment.parcels.length,
          fileName: source.fileName,
          sha256: source.sha256,
          content: new Uint8Array(source.content),
          uploadedByUserId: source.uploadedByUserId,
          parcels: {
            create: attachment.parcels.map((parcel) => ({
              parcelNumber: parcel.parcelNumber,
              clientReference: parcel.clientReference,
              codReference: parcel.codReference,
              pickupDate: day(parcel.pickupDate),
              deliveryDate: day(parcel.deliveryDate),
              fee: parcel.fee,
              codValue: parcel.codValue,
              codFee: parcel.codFee,
              cardFee: parcel.cardFee,
            })),
          },
        },
        select: { id: true },
      });
      return { id: created.id, duplicate: false };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const existing = await prisma.glsInvoice.findFirst({
        where: {
          OR: [
            { sha256: source.sha256 },
            { invoiceNumber: attachment.invoiceNumber },
          ],
        },
        select: { id: true },
      });
      if (!existing) throw error;
      return { id: existing.id, duplicate: true };
    }
  }

  /** A compensation letter; the same file again is a duplicate. */
  async createCompensationLetter(
    source: StoredSource,
    letter: GlsCompensation,
  ): Promise<{ id: string; duplicate: boolean }> {
    try {
      const created = await prisma.glsCompensationLetter.create({
        data: {
          compensationDate: day(letter.date)!,
          clientNumber: letter.clientNumber,
          cod: letter.cod,
          compensated: letter.compensated,
          transferred: letter.transferred,
          debt: letter.debt,
          remaining: letter.remaining,
          references: letter.references,
          fileName: source.fileName,
          sha256: source.sha256,
          content: new Uint8Array(source.content),
          uploadedByUserId: source.uploadedByUserId,
        },
        select: { id: true },
      });
      return { id: created.id, duplicate: false };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const existing = await prisma.glsCompensationLetter.findUnique({
        where: { sha256: source.sha256 },
        select: { id: true },
      });
      if (!existing) throw error;
      return { id: existing.id, duplicate: true };
    }
  }

  /** Lines a person has not decided, optionally only for these parcels. */
  unresolvedLines(
    where: { reportId?: string; parcelNumbers?: readonly string[] } = {},
  ): Promise<UnresolvedLine[]> {
    return prisma.glsCodReportLine.findMany({
      where: {
        status: "NEEDS_REVIEW",
        manualApprovedAt: null,
        ...(where.reportId ? { reportId: where.reportId } : {}),
        ...(where.parcelNumbers
          ? { parcelNumber: { in: [...where.parcelNumbers] } }
          : {}),
      },
      select: {
        id: true,
        reportId: true,
        parcelNumber: true,
        codReference: true,
      },
    });
  }

  /** Parcel -> the client reference of its latest GLS invoice. */
  async clientReferences(
    parcelNumbers: readonly string[],
  ): Promise<Map<string, string>> {
    if (parcelNumbers.length === 0) return new Map();
    const parcels = await prisma.glsInvoiceParcel.findMany({
      where: {
        parcelNumber: { in: [...new Set(parcelNumbers)] },
        clientReference: { not: null },
      },
      select: { parcelNumber: true, clientReference: true },
      orderBy: { invoice: { createdAt: "asc" } },
    });
    return new Map(
      parcels.map((parcel) => [parcel.parcelNumber, parcel.clientReference!]),
    );
  }

  async existingInvoiceNumbers(
    numbers: readonly string[],
  ): Promise<Set<string>> {
    if (numbers.length === 0) return new Set();
    const invoices = await prisma.invoice.findMany({
      where: {
        direction: "OUTBOUND",
        invoiceNumber: { in: [...new Set(numbers)] },
      },
      select: { invoiceNumber: true },
    });
    return new Set(invoices.map((invoice) => invoice.invoiceNumber!));
  }

  /**
   * Webshop order key -> its outgoing invoice numbers, through the local
   * mirror (the same chain as the Foxpost settlement, without its webshop
   * call). A key with no order is missing from the map.
   */
  async orderInvoiceNumbers(
    keys: readonly string[],
  ): Promise<Map<string, string[]>> {
    if (keys.length === 0) return new Map();
    const references = await prisma.externalReference.findMany({
      where: {
        system: "UNAS",
        entityType: "SalesOrder",
        externalKey: { in: [...new Set(keys)] },
      },
      select: { entityId: true, externalKey: true },
    });
    const orders = await prisma.salesOrder.findMany({
      where: { id: { in: references.map((reference) => reference.entityId) } },
      select: {
        id: true,
        invoices: {
          where: { direction: "OUTBOUND", invoiceNumber: { not: null } },
          select: { invoiceNumber: true },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    const byId = new Map(orders.map((order) => [order.id, order]));
    const out = new Map<string, string[]>();
    for (const reference of references) {
      const order = byId.get(reference.entityId);
      if (!order || !reference.externalKey) continue;
      out.set(
        reference.externalKey,
        order.invoices.map((invoice) => invoice.invoiceNumber!),
      );
    }
    return out;
  }

  async saveResolutions(
    resolutions: ReadonlyArray<{
      lineId: string;
      resolution: GlsLineResolution;
    }>,
  ): Promise<void> {
    await prisma.$transaction(
      resolutions.map(({ lineId, resolution }) =>
        prisma.glsCodReportLine.updateMany({
          // a person's decision is never overwritten
          where: { id: lineId, manualApprovedAt: null },
          data:
            resolution.status === "RESOLVED"
              ? {
                  status: "RESOLVED",
                  resolutionSource: resolution.source,
                  invoiceNumbers: resolution.invoiceNumbers,
                  errorCode: null,
                  suggestedInvoiceNumber: null,
                }
              : {
                  status: "NEEDS_REVIEW",
                  resolutionSource: null,
                  invoiceNumbers: [],
                  errorCode: resolution.errorCode,
                  suggestedInvoiceNumber: resolution.suggestedInvoiceNumber,
                },
        }),
      ),
    );
  }

  /** A report is COMPLETED when none of its lines needs review. */
  async refreshReportStatus(reportIds: readonly string[]): Promise<void> {
    for (const id of new Set(reportIds)) {
      const open = await prisma.glsCodReportLine.count({
        where: { reportId: id, status: "NEEDS_REVIEW" },
      });
      await prisma.glsCodReport.update({
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
    const updated = await prisma.glsCodReportLine.updateMany({
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
      const exists = await prisma.glsCodReportLine.findFirst({
        where: { id: input.lineId, reportId: input.reportId },
        select: { id: true },
      });
      if (!exists) throw new NotFoundException("GLS_COD_LINE_NOT_FOUND");
      throw new ConflictException("GLS_COD_LINE_CHANGED");
    }
  }

  async listReports(query: {
    status?: "COMPLETED" | "NEEDS_REVIEW";
    page: number;
    pageSize: number;
  }): Promise<GlsCodReportListResponse> {
    const where = query.status ? { status: query.status } : {};
    const [total, reports] = await Promise.all([
      prisma.glsCodReport.count({ where }),
      prisma.glsCodReport.findMany({
        where,
        orderBy: [{ transferDate: "desc" }, { createdAt: "desc" }],
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

  async reportDetail(id: string): Promise<GlsCodReportDetail> {
    const report = await prisma.glsCodReport.findUnique({
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
    if (!report) throw new NotFoundException("GLS_COD_REPORT_NOT_FOUND");
    const clientReferences = await this.clientReferences(
      report.lines.map((line) => line.parcelNumber),
    );
    return {
      ...summary(report),
      lines: report.lines.map((line): GlsCodReportLine => ({
        id: line.id,
        rowNumber: line.rowNumber,
        reportNumber: line.reportNumber ?? undefined,
        parcelNumber: line.parcelNumber,
        codReference: line.codReference ?? undefined,
        clientReference: clientReferences.get(line.parcelNumber),
        deliveryDate: isoDay(line.deliveryDate),
        amount: line.amount.toString(),
        invoiceNumbers: line.invoiceNumbers,
        status: line.status,
        resolutionSource: line.resolutionSource ?? undefined,
        errorCode: (line.errorCode as GlsCodLineError | null) ?? undefined,
        suggestedInvoiceNumber: line.suggestedInvoiceNumber ?? undefined,
        manualApprovedAt: line.manualApprovedAt?.toISOString(),
        manualApprovedByDisplayName:
          line.manualApprovedBy?.displayName ?? undefined,
        updatedAt: line.updatedAt.toISOString(),
      })),
    };
  }

  /** The month's transfers (by transfer day) and GLS invoices (by date). */
  async monthData(year: number, month: number) {
    const range = {
      gte: new Date(Date.UTC(year, month - 1, 1)),
      lt: new Date(Date.UTC(year, month, 1)),
    };
    const [transfers, invoices, compensations] = await Promise.all([
      prisma.glsCodReport.findMany({
        where: { transferDate: range },
        select: {
          transferDate: true,
          fileName: true,
          total: true,
          lines: {
            orderBy: { rowNumber: "asc" },
            select: {
              rowNumber: true,
              parcelNumber: true,
              codReference: true,
              amount: true,
              invoiceNumbers: true,
              status: true,
              errorCode: true,
            },
          },
        },
      }),
      prisma.glsInvoice.findMany({
        where: { invoiceDate: range },
        select: {
          invoiceNumber: true,
          invoiceDate: true,
          parcelCount: true,
          feeTotal: true,
          cardFeeTotal: true,
        },
      }),
      prisma.glsCompensationLetter.findMany({
        where: { compensationDate: range },
        orderBy: [{ compensationDate: "asc" }, { createdAt: "asc" }],
        select: {
          compensationDate: true,
          fileName: true,
          cod: true,
          compensated: true,
          transferred: true,
          references: true,
        },
      }),
    ]);
    return { transfers, invoices, compensations };
  }

  async listInvoices(): Promise<GlsInvoiceSummary[]> {
    const invoices = await prisma.glsInvoice.findMany({
      orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
      take: 200,
      select: {
        id: true,
        invoiceNumber: true,
        invoiceDate: true,
        currency: true,
        feeTotal: true,
        cardFeeTotal: true,
        parcelCount: true,
        fileName: true,
        createdAt: true,
      },
    });
    return invoices.map((invoice) => ({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: isoDay(invoice.invoiceDate),
      currency: invoice.currency,
      feeTotal: invoice.feeTotal.toString(),
      cardFeeTotal: invoice.cardFeeTotal.toString(),
      parcelCount: invoice.parcelCount,
      fileName: invoice.fileName,
      createdAt: invoice.createdAt.toISOString(),
    }));
  }
}

const summarySelect = {
  id: true,
  fileName: true,
  transferDate: true,
  currency: true,
  total: true,
  lineCount: true,
  status: true,
  createdAt: true,
} as const;

function summary(report: {
  id: string;
  fileName: string;
  transferDate: Date;
  currency: string;
  total: Prisma.Decimal;
  lineCount: number;
  status: "COMPLETED" | "NEEDS_REVIEW";
  createdAt: Date;
  _count: { lines: number };
}): GlsCodReportSummary {
  return {
    id: report.id,
    fileName: report.fileName,
    transferDate: isoDay(report.transferDate)!,
    currency: report.currency,
    total: report.total.toString(),
    lineCount: report.lineCount,
    resolvedLineCount: report._count.lines,
    status: report.status,
    createdAt: report.createdAt.toISOString(),
  };
}
