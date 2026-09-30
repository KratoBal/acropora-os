import { BadRequestException, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import type {
  SimplePayLineError,
  SimplePayManualApprovalInput,
  SimplePayReportDetail,
  SimplePayReportListResponse,
  SimplePayReportUploadResult,
} from "@acropora/types";

import {
  readSimplePayMailSummary,
  readSimplePayReport,
  SimplePayReportError,
  type SimplePayReport,
} from "./simplepay-report.parser.js";
import { SimplePayMonthlyReportXlsx } from "./simplepay-monthly-report.xlsx.js";
import { resolveSimplePayLine } from "./simplepay-resolution.js";
import {
  SimplePaySettlementRepository,
  type UnresolvedSimplePayLine,
} from "./simplepay-settlement.repository.js";

/** Why a payment waits, in the words the accountant reads (as on the page). */
const REVIEW_REASONS: Record<SimplePayLineError, string> = {
  REFERENCE_UNKNOWN: "Az azonosítóból nem olvasható ki a rendelés",
  ORDER_NOT_FOUND: "A rendelés nincs a rendszerben",
  ORDER_AMBIGUOUS: "Több rendelés illik rá",
  AMOUNT_MISMATCH: "A rendelés végösszege más",
  ORDER_NOT_INVOICED: "A rendelésnek még nincs számlája",
};

/** What the person sees when a file is refused, per reader error. */
const REPORT_ERRORS: Record<string, string> = {
  SIMPLEPAY_EMPTY: "A fájl üres.",
  SIMPLEPAY_COLUMNS_MISSING:
    "Ez nem SimplePay forgalmi kimutatás: hiányoznak az elszámolás oszlopai.",
  SIMPLEPAY_AMOUNT_INVALID: "Egy összeg nem olvasható a kimutatásban.",
  SIMPLEPAY_DATE_INVALID: "Egy dátum nem olvasható a kimutatásban.",
  SIMPLEPAY_ID_MISSING: "Egy sorból hiányzik a tranzakció azonosítója.",
  SIMPLEPAY_MIXED_CURRENCY:
    "A kimutatásban több pénznem áll; ilyet még nem láttunk, ezért nem olvassuk be találgatva.",
};

/** "report_20260930.csv" -> "2026-09-30" */
export function reportDateOf(fileName: string): string | null {
  const match = /report_(\d{4})(\d{2})(\d{2})\.csv$/i.exec(fileName);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

/**
 * The mail's own summary against the CSV. SimplePay writes both; a CSV that
 * disagrees with its own mail is stored, and the report says so.
 */
export function summaryWarnings(
  report: SimplePayReport,
  body: string | null,
): {
  warnings: string[];
  periodStart: string | null;
  periodEnd: string | null;
} {
  const summary = body ? readSimplePayMailSummary(body) : null;
  if (!summary) return { warnings: [], periodStart: null, periodEnd: null };
  const warnings: string[] = [];
  const differs = (mail: number | null, csv: number) =>
    mail !== null && Math.round(mail * 100) !== Math.round(csv * 100);
  if (differs(summary.transactionCount, report.transactions.length))
    warnings.push(
      `A levél ${summary.transactionCount} tranzakciót ír, a fájlban ${report.transactions.length} áll.`,
    );
  if (differs(summary.amountTotal, report.amountTotal))
    warnings.push(
      `A levél végösszege ${summary.amountTotal}, a fájl sorainak összege ${report.amountTotal}.`,
    );
  if (differs(summary.commissionTotal, report.commissionTotal))
    warnings.push(
      `A levél jutaléka ${summary.commissionTotal}, a fájl sorainak jutaléka ${report.commissionTotal}.`,
    );
  return {
    warnings,
    periodStart: summary.periodStart,
    periodEnd: summary.periodEnd,
  };
}

@Injectable()
export class SimplePaySettlementService {
  constructor(
    private readonly repository: SimplePaySettlementRepository,
    private readonly reports: SimplePayMonthlyReportXlsx,
  ) {}

  /** A weekly report uploaded by hand. */
  async upload(
    buffer: Buffer,
    fileName: string,
    actorUserId: string,
  ): Promise<SimplePayReportUploadResult> {
    try {
      return await this.ingest(buffer, fileName, {
        actorUserId,
        gmailMessageId: null,
        mailBody: null,
      });
    } catch (error) {
      if (error instanceof SimplePayReportError)
        throw new BadRequestException(
          REPORT_ERRORS[error.code] ??
            `A SimplePay-kimutatás nem dolgozható fel (${error.code}).`,
        );
      throw error;
    }
  }

  /**
   * The same, for the mail pull as well: the mail's body brings the period
   * and SimplePay's own totals, checked against the file.
   */
  async ingest(
    buffer: Buffer,
    fileName: string,
    origin: {
      actorUserId: string | null;
      gmailMessageId: string | null;
      mailBody: string | null;
    },
  ): Promise<SimplePayReportUploadResult> {
    const report = readSimplePayReport(buffer);
    const fromMail = summaryWarnings(report, origin.mailBody);
    const stored = await this.repository.createReport(
      {
        fileName,
        sha256: createHash("sha256").update(buffer).digest("hex"),
        content: buffer,
        uploadedByUserId: origin.actorUserId,
        gmailMessageId: origin.gmailMessageId,
      },
      report,
      {
        reportDate: reportDateOf(fileName),
        periodStart: fromMail.periodStart,
        periodEnd: fromMail.periodEnd,
        warnings: [...report.warnings, ...fromMail.warnings],
      },
    );
    const resolved = stored.duplicate
      ? 0
      : await this.resolve(await this.repository.unresolvedLines(stored.id));
    if (!stored.duplicate)
      await this.repository.refreshReportStatus([stored.id]);
    return {
      id: stored.id,
      duplicate: stored.duplicate,
      resolvedLineCount: resolved,
      lineCount: report.transactions.length,
    };
  }

  /** Resolves the given open lines; returns how many became resolved. */
  private async resolve(
    lines: readonly UnresolvedSimplePayLine[],
  ): Promise<number> {
    if (lines.length === 0) return 0;
    const candidates = await this.repository.orderCandidates(
      lines.flatMap((line) =>
        line.orderKeySuffix ? [line.orderKeySuffix] : [],
      ),
    );
    const resolutions = lines.map((line) => ({
      lineId: line.id,
      resolution: resolveSimplePayLine(
        { orderKeySuffix: line.orderKeySuffix, amount: Number(line.amount) },
        line.orderKeySuffix ? (candidates.get(line.orderKeySuffix) ?? []) : [],
      ),
    }));
    await this.repository.saveResolutions(resolutions);
    return resolutions.filter(
      ({ resolution }) => resolution.status === "RESOLVED",
    ).length;
  }

  /**
   * The open lines of one report, again: an order synced or invoiced since
   * can resolve them now.
   */
  async reprocess(id: string): Promise<SimplePayReportDetail> {
    await this.repository.reportDetail(id);
    await this.resolve(await this.repository.unresolvedLines(id));
    await this.repository.refreshReportStatus([id]);
    return this.repository.reportDetail(id);
  }

  /** The month's file in Luca's table shape, built from what is stored now. */
  async monthlyReport(year: number, month: number) {
    if (!Number.isInteger(year) || year < 2020 || year > 2100)
      throw new BadRequestException("SIMPLEPAY_REPORT_YEAR_INVALID");
    if (!Number.isInteger(month) || month < 1 || month > 12)
      throw new BadRequestException("SIMPLEPAY_REPORT_MONTH_INVALID");
    const reports = await this.repository.monthData(year, month);
    return this.reports.build(
      year,
      month,
      reports.map((report) => {
        const open = report.lines.filter(
          (line) => line.status === "NEEDS_REVIEW",
        );
        return {
          reportDate: report.reportDate,
          fileName: report.fileName,
          amountTotal: Number(report.amountTotal),
          commissionTotal: Number(report.commissionTotal),
          netTotal: Number(report.netTotal),
          invoiceNumbers: report.lines
            .filter((line) => line.status === "RESOLVED")
            .flatMap((line) => line.invoiceNumbers),
          notInvoiced: open
            .filter((line) => line.errorCode === "ORDER_NOT_INVOICED")
            .map((line) => ({
              amount: Number(line.amount),
              orderNumber: line.orderNumber,
            })),
          review: open.map((line) => ({
            merchantTransactionId: line.merchantTransactionId,
            transactionAt: line.transactionAt,
            amount: Number(line.amount),
            orderNumber: line.orderNumber,
            reason:
              REVIEW_REASONS[line.errorCode as SimplePayLineError] ??
              "Ellenőrzendő",
          })),
        };
      }),
    );
  }

  listReports(query: {
    status?: "COMPLETED" | "NEEDS_REVIEW";
    page: number;
    pageSize: number;
  }): Promise<SimplePayReportListResponse> {
    return this.repository.listReports(query);
  }

  reportDetail(id: string): Promise<SimplePayReportDetail> {
    return this.repository.reportDetail(id);
  }

  async approveLine(
    reportId: string,
    lineId: string,
    input: SimplePayManualApprovalInput,
    actorUserId: string,
  ): Promise<SimplePayReportDetail> {
    const invoiceNumber = input.invoiceNumber.trim();
    if (!invoiceNumber)
      throw new BadRequestException("A számlaszám megadása kötelező.");
    const expectedUpdatedAt = new Date(input.expectedUpdatedAt);
    if (Number.isNaN(expectedUpdatedAt.getTime()))
      throw new BadRequestException("SIMPLEPAY_LINE_VERSION_INVALID");
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
