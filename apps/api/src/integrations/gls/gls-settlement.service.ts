import { BadRequestException, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import type {
  GlsCodLineError,
  GlsCodReportDetail,
  GlsCodReportListResponse,
  GlsDocumentUploadResult,
  GlsInvoiceSummary,
  GlsManualApprovalInput,
} from "@acropora/types";

import { classifyCodReference, orderKeyOf } from "./gls-cod-reference.js";
import { resolveGlsCodLine } from "./gls-cod-resolution.js";
import { GlsDocumentError, readGlsDocument } from "./gls-documents.parser.js";
import { GlsMonthlyReportXlsx } from "./gls-monthly-report.xlsx.js";
import {
  GlsSettlementRepository,
  type UnresolvedLine,
} from "./gls-settlement.repository.js";

/** Why a line waits, in the words the accountant reads. */
const REVIEW_REASONS: Record<GlsCodLineError, string> = {
  INVOICE_NOT_FOUND: "Nincs ilyen kimenő számla",
  ORDER_NOT_FOUND: "A rendelés nincs a rendszerben",
  ORDER_NOT_INVOICED: "A rendelésnek még nincs számlája",
  PREFIX_MISSING: "Előtag nélküli számlaszám",
  REFERENCE_UNKNOWN: "Ismeretlen hivatkozás",
};

/** What the person sees when a file is refused, per reader error. */
const DOCUMENT_ERRORS: Record<string, string> = {
  GLS_XLSX_INVALID: "A fájl nem olvasható XLSX.",
  GLS_DOCUMENT_UNKNOWN:
    "Ez nem GLS utánvét-részletező és nem GLS számlamelléklet.",
  GLS_COD_TOTAL_MISMATCH:
    "Az utánvét-részletező sorainak összege nem egyezik az összesítővel.",
};

@Injectable()
export class GlsSettlementService {
  constructor(
    private readonly repository: GlsSettlementRepository,
    private readonly reports: GlsMonthlyReportXlsx,
  ) {}

  /**
   * One GLS file, either kind. A report's lines are resolved at once; an
   * invoice attachment brings client references, so the open lines of its
   * parcels are resolved again.
   */
  async upload(
    buffer: Buffer,
    fileName: string,
    actorUserId: string,
  ): Promise<GlsDocumentUploadResult> {
    let document: ReturnType<typeof readGlsDocument>;
    try {
      document = readGlsDocument(buffer, fileName);
    } catch (error) {
      if (error instanceof GlsDocumentError)
        throw new BadRequestException(
          DOCUMENT_ERRORS[error.code] ??
            `A GLS-fájl nem dolgozható fel (${error.code}).`,
        );
      throw error;
    }
    const source = {
      fileName,
      sha256: createHash("sha256").update(buffer).digest("hex"),
      content: buffer,
      uploadedByUserId: actorUserId,
    };
    if (document.kind === "COD_REPORT") {
      const stored = await this.repository.createCodReport(
        source,
        document.report,
      );
      const resolved = stored.duplicate
        ? 0
        : await this.resolve(
            await this.repository.unresolvedLines({ reportId: stored.id }),
          );
      return {
        kind: "COD_REPORT",
        id: stored.id,
        duplicate: stored.duplicate,
        newlyResolvedLineCount: resolved,
      };
    }
    const stored = await this.repository.createInvoice(
      source,
      document.attachment,
    );
    const resolved = stored.duplicate
      ? 0
      : await this.resolve(
          await this.repository.unresolvedLines({
            parcelNumbers: document.attachment.parcels.map(
              (parcel) => parcel.parcelNumber,
            ),
          }),
        );
    return {
      kind: "INVOICE_ATTACHMENT",
      id: stored.id,
      duplicate: stored.duplicate,
      newlyResolvedLineCount: resolved,
    };
  }

  /** Resolves the given open lines; returns how many became resolved. */
  private async resolve(lines: readonly UnresolvedLine[]): Promise<number> {
    if (lines.length === 0) return 0;
    const clientReferences = await this.repository.clientReferences(
      lines.map((line) => line.parcelNumber),
    );
    const invoiceNumbers: string[] = [];
    const orderKeys: string[] = [];
    for (const line of lines) {
      const reference = classifyCodReference(line.codReference);
      if (reference.kind === "INVOICES")
        invoiceNumbers.push(...reference.invoiceNumbers);
      if (reference.kind === "ORDER_KEY") orderKeys.push(reference.orderKey);
      const clientKey = orderKeyOf(clientReferences.get(line.parcelNumber));
      if (clientKey) orderKeys.push(clientKey);
    }
    const [existingInvoiceNumbers, orderInvoiceNumbers] = await Promise.all([
      this.repository.existingInvoiceNumbers(invoiceNumbers),
      this.repository.orderInvoiceNumbers(orderKeys),
    ]);
    const resolutions = lines.map((line) => ({
      lineId: line.id,
      resolution: resolveGlsCodLine(
        {
          codReference: line.codReference,
          clientReference: clientReferences.get(line.parcelNumber) ?? null,
        },
        { existingInvoiceNumbers, orderInvoiceNumbers },
      ),
    }));
    await this.repository.saveResolutions(resolutions);
    await this.repository.refreshReportStatus(
      lines.map((line) => line.reportId),
    );
    return resolutions.filter(
      ({ resolution }) => resolution.status === "RESOLVED",
    ).length;
  }

  /**
   * The open lines of one report, again: an order invoiced since, or a GLS
   * invoice attachment uploaded since, can resolve them now.
   */
  async reprocess(id: string): Promise<GlsCodReportDetail> {
    await this.repository.reportDetail(id);
    await this.resolve(await this.repository.unresolvedLines({ reportId: id }));
    return this.repository.reportDetail(id);
  }

  /** The accountant's file for one month, built from what is stored now. */
  async monthlyReport(year: number, month: number) {
    if (!Number.isInteger(year) || year < 2020 || year > 2100)
      throw new BadRequestException("GLS_REPORT_YEAR_INVALID");
    if (!Number.isInteger(month) || month < 1 || month > 12)
      throw new BadRequestException("GLS_REPORT_MONTH_INVALID");
    const { transfers, invoices } = await this.repository.monthData(
      year,
      month,
    );
    return this.reports.build(
      year,
      month,
      transfers.map((transfer) => ({
        transferDate: transfer.transferDate,
        fileName: transfer.fileName,
        total: Number(transfer.total),
        invoiceNumbers: transfer.lines.flatMap((line) => line.invoiceNumbers),
        unresolvedLines: transfer.lines
          .filter((line) => line.status === "NEEDS_REVIEW")
          .map((line) => ({
            rowNumber: line.rowNumber,
            parcelNumber: line.parcelNumber,
            codReference: line.codReference,
            amount: Number(line.amount),
            reason:
              REVIEW_REASONS[line.errorCode as GlsCodLineError] ??
              "Ellenőrzendő",
          })),
      })),
      invoices.map((invoice) => ({
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.invoiceDate,
        parcelCount: invoice.parcelCount,
        feeTotal: Number(invoice.feeTotal),
        cardFeeTotal: Number(invoice.cardFeeTotal),
      })),
    );
  }

  listReports(query: {
    status?: "COMPLETED" | "NEEDS_REVIEW";
    page: number;
    pageSize: number;
  }): Promise<GlsCodReportListResponse> {
    return this.repository.listReports(query);
  }

  reportDetail(id: string): Promise<GlsCodReportDetail> {
    return this.repository.reportDetail(id);
  }

  listInvoices(): Promise<GlsInvoiceSummary[]> {
    return this.repository.listInvoices();
  }

  async approveLine(
    reportId: string,
    lineId: string,
    input: GlsManualApprovalInput,
    actorUserId: string,
  ): Promise<GlsCodReportDetail> {
    const invoiceNumber = input.invoiceNumber.trim();
    if (!invoiceNumber)
      throw new BadRequestException("A számlaszám megadása kötelező.");
    const expectedUpdatedAt = new Date(input.expectedUpdatedAt);
    if (Number.isNaN(expectedUpdatedAt.getTime()))
      throw new BadRequestException("GLS_COD_LINE_VERSION_INVALID");
    await this.repository.approveLine({
      reportId,
      lineId,
      invoiceNumber,
      expectedUpdatedAt,
      actorUserId,
    });
    await this.repository.refreshReportStatus([reportId]);
    return this.repository.reportDetail(reportId);
  }
}
