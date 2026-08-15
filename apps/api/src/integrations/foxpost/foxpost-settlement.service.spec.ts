import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { UnasApiClient } from "../../imports/unas/unas-api.client.js";
import type { UnasAuthService } from "../../imports/unas/unas-auth.service.js";
import type { FoxpostGmailClient } from "./foxpost-gmail.client.js";
import type {
  FoxpostMonthlyReportXlsx,
  FoxpostReportSettlement,
} from "./foxpost-monthly-report.xlsx.js";
import type { FoxpostSettlementParser } from "./foxpost-settlement.parser.js";
import type {
  FoxpostResolvedLineInput,
  FoxpostSettlementRepository,
} from "./foxpost-settlement.repository.js";
import { FoxpostSettlementService } from "./foxpost-settlement.service.js";

describe("FoxpostSettlementService", () => {
  it("uses local invoices first, falls back to read-only UNAS lookup, and rebuilds the monthly report", async () => {
    let savedLines: readonly FoxpostResolvedLineInput[] = [];
    let savedReport = false;
    let unasCalls = 0;
    const xlsx = {
      partnerCode: "W0166840",
      settlementCode: "26H31",
      periodStart: new Date("2026-07-27T00:00:00.000Z"),
      periodEnd: new Date("2026-08-02T00:00:00.000Z"),
      collectedAmount: 30_000,
      invoiceGrossAmount: 3_000,
      transferredAmount: 27_000,
      currency: "HUF",
      lines: [
        {
          sourceRowNumber: 11,
          referenceCode: "LOCAL-1",
          transactionDate: new Date("2026-07-31T00:00:00.000Z"),
          recipientName: "Helyi Vevő",
          parcelBarcode: "FOX-1",
          collectedAmount: 10_000,
        },
        {
          sourceRowNumber: 12,
          referenceCode: "REMOTE-2",
          transactionDate: new Date("2026-08-01T00:00:00.000Z"),
          recipientName: "Távoli Vevő",
          parcelBarcode: "FOX-2",
          collectedAmount: 20_000,
        },
      ],
    };
    const pdf = {
      partnerCode: "W0166840",
      settlementCode: "26H31",
      periodStart: new Date("2026-07-27T00:00:00.000Z"),
      periodEnd: new Date("2026-08-02T00:00:00.000Z"),
      invoiceNumber: "FX01015386",
      invoiceIssueDate: new Date("2026-08-06T00:00:00.000Z"),
      invoiceGrossAmount: 3_000,
      currency: "HUF",
    };
    const repository = {
      createRun: async () => "run-1",
      hasMessage: async () => false,
      createPending: async () => "settlement-1",
      resolveLocal: async () => [
        {
          referenceCode: "LOCAL-1",
          salesOrderId: "order-1",
          invoiceId: "invoice-1",
          invoiceNumber: "ACRW-2026/00001",
        },
        {
          referenceCode: "REMOTE-2",
          salesOrderId: "order-2",
          invoiceId: null,
          invoiceNumber: null,
        },
      ],
      manualLineResolutions: async () => [],
      saveProcessingResult: async (
        _id: string,
        _xlsx: unknown,
        _pdf: unknown,
        lines: readonly FoxpostResolvedLineInput[],
      ) => {
        savedLines = lines;
      },
      reportSource: async () => [
        {
          invoiceIssueDate: pdf.invoiceIssueDate,
          settlementCode: pdf.settlementCode,
          foxpostInvoiceNumber: pdf.invoiceNumber,
          collectedAmount: xlsx.collectedAmount,
          invoiceGrossAmount: pdf.invoiceGrossAmount,
          transferredAmount: xlsx.transferredAmount,
          invoiceNumbers: ["ACRW-2026/00001", "ACRW-2026/00002"],
          unresolvedLines: [],
        },
      ],
      saveReport: async () => {
        savedReport = true;
      },
      completeRun: async (runId: string, counts: Record<string, number>) => ({
        runId,
        status: "APPLIED" as const,
        ...counts,
      }),
      failRun: async () => undefined,
      markError: async () => undefined,
    } as unknown as FoxpostSettlementRepository;
    const service = new FoxpostSettlementService(
      {
        listCandidateMessageIds: async () => ["message-1"],
        getMessage: async () => ({
          id: "message-1",
          threadId: "thread-1",
          internalDate: new Date(),
          subject: "Foxpost",
          from: "Foxpost",
          xlsx: {
            attachmentId: "xlsx-1",
            filename: "foxpost.xlsx",
            mimeType:
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            buffer: Buffer.from("xlsx"),
          },
          pdf: {
            attachmentId: "pdf-1",
            filename: "invoice.pdf",
            mimeType: "application/pdf",
            buffer: Buffer.from("pdf"),
          },
        }),
      } as unknown as FoxpostGmailClient,
      {
        parseXlsx: async () => xlsx,
        parsePdf: async () => pdf,
      } as unknown as FoxpostSettlementParser,
      repository,
      {
        build: async () => ({
          filename: "foxpost-2026-08.xlsx",
          buffer: Buffer.from("report"),
          settlementCount: 1,
          invoiceCount: 2,
          collectedAmount: 30_000,
          invoiceGrossAmount: 3_000,
          transferredAmount: 27_000,
        }),
      } as unknown as FoxpostMonthlyReportXlsx,
      { getToken: async () => "unas-token" } as UnasAuthService,
      {
        getOrderByKey: async (_token: string, key: string) => {
          unasCalls += 1;
          assert.equal(key, "REMOTE-2");
          return {
            key,
            invoiceStatus: "BILLED",
            invoiceNumber: "ACRW-2026/00002",
          };
        },
      } as unknown as UnasApiClient,
    );

    const result = await service.sync();
    assert.equal(result.createdCount, 1);
    assert.equal(result.needsReviewCount, 0);
    assert.equal(unasCalls, 1);
    assert.equal(savedLines[0]?.resolutionSource, "LOCAL");
    assert.equal(savedLines[0]?.invoiceNumber, "ACRW-2026/00001");
    assert.equal(savedLines[1]?.resolutionSource, "UNAS");
    assert.equal(savedLines[1]?.salesOrderId, "order-2");
    assert.equal(savedLines[1]?.invoiceNumber, "ACRW-2026/00002");
    assert.equal(savedReport, true);
  });

  it("stores a manual invoice approval and regenerates the affected monthly report", async () => {
    let approvalInput: Record<string, unknown> | undefined;
    let savedReportCount = 0;
    let buildCount = 0;
    const detail = {
      id: "settlement-1",
      gmailMessageId: "message-1",
      xlsxFileName: "foxpost.xlsx",
      pdfFileName: "invoice.pdf",
      currency: "HUF",
      status: "COMPLETED" as const,
      matchedLineCount: 1,
      unresolvedLineCount: 0,
      createdAt: "2026-08-06T12:00:00.000Z",
      lines: [],
    };
    const repository = {
      approveLine: async (input: Record<string, unknown>) => {
        approvalInput = input;
        return { year: 2026, month: 8 };
      },
      reportSource: async () => [
        {
          invoiceIssueDate: new Date("2026-08-06T00:00:00.000Z"),
          settlementCode: "26H31",
          foxpostInvoiceNumber: "FX01015386",
          collectedAmount: 4_000,
          invoiceGrossAmount: 1_000,
          transferredAmount: 3_000,
          invoiceNumbers: ["ACRW-2026/00400"],
          unresolvedLines: [],
        },
      ],
      saveReport: async () => {
        savedReportCount += 1;
      },
      detail: async () => detail,
    } as unknown as FoxpostSettlementRepository;
    const service = new FoxpostSettlementService(
      {} as FoxpostGmailClient,
      {} as FoxpostSettlementParser,
      repository,
      {
        build: async () => {
          buildCount += 1;
          return {
            filename: "foxpost-2026-08.xlsx",
            buffer: Buffer.from("fresh-report"),
            settlementCount: 1,
            invoiceCount: 1,
            collectedAmount: 4_000,
            invoiceGrossAmount: 1_000,
            transferredAmount: 3_000,
          };
        },
      } as unknown as FoxpostMonthlyReportXlsx,
      {} as UnasAuthService,
      {} as UnasApiClient,
    );

    const result = await service.approveLine(
      "settlement-1",
      "line-1",
      {
        invoiceNumber: "  ACRW-2026/00400  ",
        expectedUpdatedAt: "2026-08-15T08:00:00.000Z",
      },
      "user-1",
    );

    assert.equal(approvalInput?.invoiceNumber, "ACRW-2026/00400");
    assert.equal(approvalInput?.actorUserId, "user-1");
    assert.equal(savedReportCount, 1);
    assert.equal(result.reportRegenerated, true);
    assert.equal(result.settlement.status, "COMPLETED");

    const download = await service.downloadReport(2026, 8);
    assert.equal(savedReportCount, 1);
    assert.equal(buildCount, 2);
    assert.equal(download.buffer.toString(), "fresh-report");
  });

  it("regenerates a downloadable report even when a settlement still needs review", async () => {
    let savedLines: readonly FoxpostResolvedLineInput[] = [];
    let reportBuilt = false;
    const xlsx = {
      partnerCode: "W0166840",
      settlementCode: "26H27",
      periodStart: new Date("2026-07-06T00:00:00.000Z"),
      periodEnd: new Date("2026-07-12T00:00:00.000Z"),
      collectedAmount: 4_000,
      invoiceGrossAmount: 1_000,
      transferredAmount: 3_000,
      currency: "HUF",
      lines: [
        {
          sourceRowNumber: 14,
          referenceCode: "ACRW-2026/00400",
          transactionDate: new Date("2026-07-09T00:00:00.000Z"),
          recipientName: "Kovács András",
          parcelBarcode: "CLFOX123",
          collectedAmount: 4_000,
        },
      ],
    };
    const pdf = {
      partnerCode: "W0166840",
      settlementCode: "26H27",
      periodStart: xlsx.periodStart,
      periodEnd: xlsx.periodEnd,
      invoiceNumber: "FX01010000",
      invoiceIssueDate: new Date("2026-07-16T00:00:00.000Z"),
      invoiceGrossAmount: 1_000,
      currency: "HUF",
    };
    const repository = {
      storedSource: async () => ({
        xlsx: Buffer.from("xlsx"),
        pdf: Buffer.from("pdf"),
      }),
      resolveLocal: async () => [],
      manualLineResolutions: async () => [],
      saveProcessingResult: async (
        _id: string,
        _xlsx: unknown,
        _pdf: unknown,
        lines: readonly FoxpostResolvedLineInput[],
      ) => {
        savedLines = lines;
      },
      reportSource: async () => [
        {
          invoiceIssueDate: pdf.invoiceIssueDate,
          settlementCode: pdf.settlementCode,
          foxpostInvoiceNumber: pdf.invoiceNumber,
          collectedAmount: xlsx.collectedAmount,
          invoiceGrossAmount: pdf.invoiceGrossAmount,
          transferredAmount: xlsx.transferredAmount,
          invoiceNumbers: [],
          unresolvedLines: [
            {
              gmailMessageId: "message-1",
              gmailSubject: "Foxpost",
              sourceRowNumber: 14,
              referenceCode: "ACRW-2026/00400",
              transactionDate: xlsx.lines[0]!.transactionDate,
              recipientName: "Kovács András",
              parcelBarcode: "CLFOX123",
              collectedAmount: 4_000,
              status: "ORDER_NOT_FOUND" as const,
              errorCode: "FOXPOST_UNAS_ORDER_NOT_FOUND",
            },
          ],
        },
      ],
      saveReport: async () => undefined,
      detail: async () => ({
        id: "settlement-1",
        gmailMessageId: "message-1",
        xlsxFileName: "foxpost.xlsx",
        pdfFileName: "invoice.pdf",
        currency: "HUF",
        status: "NEEDS_REVIEW" as const,
        matchedLineCount: 0,
        unresolvedLineCount: 1,
        createdAt: "2026-07-16T12:00:00.000Z",
        lines: [],
      }),
      markError: async () => undefined,
    } as unknown as FoxpostSettlementRepository;
    const service = new FoxpostSettlementService(
      {} as FoxpostGmailClient,
      {
        parseXlsx: async () => xlsx,
        parsePdf: async () => pdf,
      } as unknown as FoxpostSettlementParser,
      repository,
      {
        build: async (
          _year: number,
          _month: number,
          source: readonly FoxpostReportSettlement[],
        ) => {
          reportBuilt = true;
          assert.equal(source[0]?.unresolvedLines.length, 1);
          return {
            filename: "foxpost-2026-07.xlsx",
            buffer: Buffer.from("report"),
            settlementCount: 1,
            invoiceCount: 0,
            collectedAmount: 4_000,
            invoiceGrossAmount: 1_000,
            transferredAmount: 3_000,
          };
        },
      } as unknown as FoxpostMonthlyReportXlsx,
      { getToken: async () => "unas-token" } as UnasAuthService,
      { getOrderByKey: async () => null } as unknown as UnasApiClient,
    );

    const result = await service.reprocess("settlement-1");

    assert.equal(savedLines[0]?.status, "ORDER_NOT_FOUND");
    assert.equal(reportBuilt, true);
    assert.equal(result.reportRegenerated, true);
    assert.equal(result.settlement.status, "NEEDS_REVIEW");
  });
});
