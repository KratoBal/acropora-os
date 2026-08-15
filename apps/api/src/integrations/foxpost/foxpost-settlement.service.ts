import { BadRequestException, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import type {
  FoxpostManualApprovalInput,
  FoxpostManualApprovalResult,
  FoxpostReprocessResult,
  FoxpostSettlementDetail,
  FoxpostSettlementListResponse,
  FoxpostSyncSummary,
} from "@acropora/types";

import { UnasApiClient } from "../../imports/unas/unas-api.client.js";
import { UnasAuthService } from "../../imports/unas/unas-auth.service.js";
import type { FoxpostSettlementListQueryDto } from "./dto/foxpost-settlement-list-query.dto.js";
import { FoxpostGmailClient } from "./foxpost-gmail.client.js";
import { FoxpostMonthlyReportXlsx } from "./foxpost-monthly-report.xlsx.js";
import {
  FoxpostParseError,
  FoxpostSettlementParser,
  validateFoxpostPair,
} from "./foxpost-settlement.parser.js";
import {
  FoxpostSettlementRepository,
  type FoxpostResolvedLineInput,
  type LocalOrderResolution,
} from "./foxpost-settlement.repository.js";

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function errorCode(error: unknown, fallback: string): string {
  if (
    error instanceof Error &&
    /^[A-Z0-9_:.-]+$/.test(error.message) &&
    error.message.length <= 200
  )
    return error.message;
  return fallback;
}

@Injectable()
export class FoxpostSettlementService {
  constructor(
    private readonly gmail: FoxpostGmailClient,
    private readonly parser: FoxpostSettlementParser,
    private readonly repository: FoxpostSettlementRepository,
    private readonly reports: FoxpostMonthlyReportXlsx,
    private readonly unasAuth: UnasAuthService,
    private readonly unasApi: UnasApiClient,
  ) {}

  list(
    query: FoxpostSettlementListQueryDto,
  ): Promise<FoxpostSettlementListResponse> {
    return this.repository.list(query);
  }

  detail(id: string): Promise<FoxpostSettlementDetail> {
    return this.repository.detail(id);
  }

  listReports() {
    return this.repository.listReports();
  }

  async downloadReport(year: number, month: number) {
    if (!Number.isInteger(year) || year < 2020 || year > 2100)
      throw new BadRequestException("FOXPOST_REPORT_YEAR_INVALID");
    if (!Number.isInteger(month) || month < 1 || month > 12)
      throw new BadRequestException("FOXPOST_REPORT_MONTH_INVALID");
    const report = await this.buildReport(year, month);
    return { filename: report.filename, buffer: report.buffer };
  }

  async sync(): Promise<FoxpostSyncSummary> {
    const runId = await this.repository.createRun();
    try {
      const messageIds = await this.gmail.listCandidateMessageIds();
      const counts = {
        messagesSeen: messageIds.length,
        createdCount: 0,
        skippedCount: 0,
        needsReviewCount: 0,
        failedCount: 0,
      };
      for (const messageId of messageIds) {
        if (await this.repository.hasMessage(messageId)) {
          counts.skippedCount += 1;
          continue;
        }
        let settlementId: string | null = null;
        try {
          const message = await this.gmail.getMessage(messageId);
          settlementId = await this.repository.createPending({
            gmailMessageId: message.id,
            gmailThreadId: message.threadId,
            gmailInternalDate: message.internalDate,
            gmailSubject: message.subject,
            gmailFrom: message.from,
            xlsxAttachmentId: message.xlsx.attachmentId,
            xlsxFileName: message.xlsx.filename,
            xlsxContent: message.xlsx.buffer,
            xlsxSha256: sha256(message.xlsx.buffer),
            pdfAttachmentId: message.pdf.attachmentId,
            pdfFileName: message.pdf.filename,
            pdfContent: message.pdf.buffer,
            pdfSha256: sha256(message.pdf.buffer),
          });
          if (!settlementId) {
            counts.skippedCount += 1;
            continue;
          }
          const result = await this.process(
            settlementId,
            message.xlsx.buffer,
            message.pdf.buffer,
          );
          counts.createdCount += 1;
          if (!result.completed) counts.needsReviewCount += 1;
        } catch (error) {
          counts.failedCount += 1;
          if (settlementId)
            await this.repository.markError(
              settlementId,
              errorCode(error, "FOXPOST_MESSAGE_PROCESSING_FAILED"),
            );
        }
      }
      return await this.repository.completeRun(runId, counts);
    } catch (error) {
      await this.repository.failRun(
        runId,
        errorCode(error, "FOXPOST_GMAIL_SYNC_FAILED"),
      );
      throw error;
    }
  }

  async reprocess(id: string): Promise<FoxpostReprocessResult> {
    const source = await this.repository.storedSource(id);
    try {
      const result = await this.process(id, source.xlsx, source.pdf);
      return {
        settlement: await this.repository.detail(id),
        reportRegenerated: result.reportRegenerated,
      };
    } catch (error) {
      await this.repository.markError(
        id,
        errorCode(error, "FOXPOST_REPROCESS_FAILED"),
      );
      throw error;
    }
  }

  async approveLine(
    settlementId: string,
    lineId: string,
    input: FoxpostManualApprovalInput,
    actorUserId: string,
  ): Promise<FoxpostManualApprovalResult> {
    const invoiceNumber = input.invoiceNumber.trim();
    if (!invoiceNumber)
      throw new BadRequestException("FOXPOST_INVOICE_NUMBER_REQUIRED");
    const expectedUpdatedAt = new Date(input.expectedUpdatedAt);
    if (Number.isNaN(expectedUpdatedAt.getTime()))
      throw new BadRequestException("FOXPOST_LINE_VERSION_INVALID");
    const period = await this.repository.approveLine({
      settlementId,
      lineId,
      invoiceNumber,
      expectedUpdatedAt,
      actorUserId,
    });
    await this.rebuildReport(period.year, period.month);
    return {
      settlement: await this.repository.detail(settlementId),
      reportRegenerated: true,
    };
  }

  private async process(
    settlementId: string,
    xlsxBuffer: Buffer,
    pdfBuffer: Buffer,
  ): Promise<{ completed: boolean; reportRegenerated: boolean }> {
    const [xlsx, pdf] = await Promise.all([
      this.parser.parseXlsx(xlsxBuffer),
      this.parser.parsePdf(pdfBuffer),
    ]);
    validateFoxpostPair(xlsx, pdf);
    const [resolvedLines, manualResolutions] = await Promise.all([
      this.resolveLines(xlsx.lines),
      this.repository.manualLineResolutions(settlementId),
    ]);
    const manualBySourceRow = new Map(
      manualResolutions.map((line) => [line.sourceRowNumber, line]),
    );
    const lines = resolvedLines.map((line) => {
      const manual = manualBySourceRow.get(line.sourceRowNumber);
      if (!manual || manual.referenceCode !== line.referenceCode) return line;
      return {
        ...line,
        salesOrderId: null,
        invoiceId: null,
        invoiceNumber: manual.invoiceNumber,
        resolutionSource: "MANUAL" as const,
        status: "MATCHED" as const,
        errorCode: null,
        manualApprovedByUserId: manual.manualApprovedByUserId,
        manualApprovedAt: manual.manualApprovedAt,
      };
    });
    await this.repository.saveProcessingResult(settlementId, xlsx, pdf, lines);
    const completed = lines.every((line) => line.status === "MATCHED");
    await this.rebuildReport(
      pdf.invoiceIssueDate.getUTCFullYear(),
      pdf.invoiceIssueDate.getUTCMonth() + 1,
    );
    return { completed, reportRegenerated: true };
  }

  private async resolveLines(
    sourceLines: readonly {
      sourceRowNumber: number;
      referenceCode: string;
      transactionDate: Date;
      recipientName: string | null;
      parcelBarcode: string | null;
      collectedAmount: number;
    }[],
  ): Promise<FoxpostResolvedLineInput[]> {
    const uniqueReferences = [
      ...new Set(sourceLines.map((line) => line.referenceCode)),
    ];
    const localRows = await this.repository.resolveLocal(uniqueReferences);
    const localByReference = new Map(
      localRows.map((row) => [row.referenceCode, row]),
    );
    const needsUnas = uniqueReferences.filter(
      (reference) => !localByReference.get(reference)?.invoiceNumber,
    );
    const remoteByReference = new Map<
      string,
      {
        found: boolean;
        invoiceNumber: string | null;
        lookupError: string | null;
      }
    >();
    if (needsUnas.length) {
      try {
        const token = await this.unasAuth.getToken();
        await Promise.all(
          needsUnas.map(async (reference) => {
            try {
              const order = await this.unasApi.getOrderByKey(token, reference);
              remoteByReference.set(reference, {
                found: Boolean(order),
                invoiceNumber:
                  order?.invoiceStatus === "BILLED"
                    ? (order.invoiceNumber ?? null)
                    : null,
                lookupError: null,
              });
            } catch (error) {
              remoteByReference.set(reference, {
                found: false,
                invoiceNumber: null,
                lookupError: errorCode(error, "FOXPOST_UNAS_LOOKUP_FAILED"),
              });
            }
          }),
        );
      } catch (error) {
        const lookupError = errorCode(error, "FOXPOST_UNAS_AUTH_FAILED");
        for (const reference of needsUnas)
          remoteByReference.set(reference, {
            found: false,
            invoiceNumber: null,
            lookupError,
          });
      }
    }

    return sourceLines.map((line) => {
      const local = localByReference.get(line.referenceCode);
      if (local?.invoiceNumber)
        return this.resolvedLine(line, local, local.invoiceNumber, "LOCAL");
      const remote = remoteByReference.get(line.referenceCode);
      if (remote?.invoiceNumber)
        return this.resolvedLine(line, local, remote.invoiceNumber, "UNAS");
      const orderKnown = Boolean(local) || Boolean(remote?.found);
      return {
        ...line,
        salesOrderId: local?.salesOrderId ?? null,
        invoiceId: local?.invoiceId ?? null,
        invoiceNumber: null,
        resolutionSource: null,
        status: orderKnown ? "INVOICE_NOT_FOUND" : "ORDER_NOT_FOUND",
        errorCode:
          remote?.lookupError ??
          (orderKnown
            ? "FOXPOST_UNAS_INVOICE_NOT_FOUND"
            : "FOXPOST_UNAS_ORDER_NOT_FOUND"),
      };
    });
  }

  private resolvedLine(
    line: {
      sourceRowNumber: number;
      referenceCode: string;
      transactionDate: Date;
      recipientName: string | null;
      parcelBarcode: string | null;
      collectedAmount: number;
    },
    local: LocalOrderResolution | undefined,
    invoiceNumber: string,
    resolutionSource: "LOCAL" | "UNAS",
  ): FoxpostResolvedLineInput {
    return {
      ...line,
      salesOrderId: local?.salesOrderId ?? null,
      invoiceId:
        local?.invoiceNumber === invoiceNumber ? local.invoiceId : null,
      invoiceNumber,
      resolutionSource,
      status: "MATCHED",
      errorCode: null,
    };
  }

  private async rebuildReport(year: number, month: number): Promise<void> {
    const report = await this.buildReport(year, month);
    await this.repository.saveReport(year, month, report);
  }

  private async buildReport(year: number, month: number) {
    const source = await this.repository.reportSource(year, month);
    if (!source.length)
      throw new FoxpostParseError("FOXPOST_MONTHLY_REPORT_SOURCE_EMPTY");
    return this.reports.build(year, month, source);
  }
}
