import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { UnasApiClient } from "../../imports/unas/unas-api.client.js";
import type { UnasAuthService } from "../../imports/unas/unas-auth.service.js";
import type { FoxpostGmailClient } from "./foxpost-gmail.client.js";
import type { FoxpostMonthlyReportXlsx } from "./foxpost-monthly-report.xlsx.js";
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
});
