import { fireEvent, render, screen } from "@testing-library/react";
import type { FoxpostSettlementListResponse, Session } from "@acropora/types";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FoxpostSettlementsPage } from "./foxpost-settlements-page";

const api = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  sync: vi.fn(),
  reprocess: vi.fn(),
  approveLine: vi.fn(),
  reports: vi.fn(),
  downloadReport: vi.fn(),
}));

const auth = vi.hoisted(() => ({
  session: null as Session | null,
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: auth.session,
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

vi.mock("@/lib/api/foxpost-settlements", () => ({
  foxpostSettlementsApi: api,
}));

const ownerSession: Session = {
  id: "session-owner",
  token: "token-owner",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "owner",
    email: "owner@acropora.local",
    displayName: "Acropora Tulajdonos",
    role: "OWNER",
  },
};

const settlements: FoxpostSettlementListResponse = {
  items: [
    {
      id: "settlement-1",
      partnerCode: "W0166840",
      settlementCode: "26H31",
      invoiceNumber: "FX01015386",
      invoiceIssueDate: "2026-08-06T00:00:00.000Z",
      currency: "HUF",
      collectedAmount: "97500",
      invoiceGrossAmount: "8317",
      transferredAmount: "89183",
      status: "COMPLETED",
      matchedLineCount: 4,
      unresolvedLineCount: 0,
      createdAt: "2026-08-06T12:00:00.000Z",
    },
  ],
  pagination: {
    page: 1,
    pageSize: 50,
    totalItems: 1,
    totalPages: 1,
  },
};

beforeEach(() => {
  auth.session = ownerSession;
  api.list.mockReset().mockResolvedValue(settlements);
  api.reports.mockReset().mockResolvedValue([]);
  api.sync.mockReset().mockResolvedValue({
    runId: "run-1",
    status: "APPLIED",
    messagesSeen: 1,
    createdCount: 1,
    skippedCount: 0,
    needsReviewCount: 0,
    failedCount: 0,
  });
  api.detail.mockReset();
  api.reprocess.mockReset();
  api.approveLine.mockReset();
  api.downloadReport.mockReset();
});

describe("FoxpostSettlementsPage", () => {
  it("shows the imported settlement and its bookkeeping totals", async () => {
    render(createElement(FoxpostSettlementsPage));
    expect(await screen.findByText("26H31")).toBeInTheDocument();
    expect(screen.getByText("FX01015386")).toBeInTheDocument();
    expect(screen.getByText("97 500 Ft")).toBeInTheDocument();
    expect(screen.getByText("89 183 Ft")).toBeInTheDocument();
  });

  it("runs the Gmail check and reports the result", async () => {
    render(createElement(FoxpostSettlementsPage));
    fireEvent.click(
      await screen.findByRole("button", { name: "Gmail ellenőrzése most" }),
    );
    expect(
      await screen.findByText(/Gmail ellenőrzés kész: 1 új/),
    ).toBeInTheDocument();
    expect(api.sync).toHaveBeenCalledWith("token-owner");
  });

  it("keeps the monthly XLSX downloadable when it contains unresolved rows", async () => {
    api.reports.mockResolvedValue([
      {
        id: "report-1",
        year: 2026,
        month: 7,
        filename: "foxpost-2026-07.xlsx",
        settlementCount: 4,
        invoiceCount: 12,
        collectedAmount: "200000",
        invoiceGrossAmount: "16000",
        transferredAmount: "184000",
        generatedAt: "2026-08-01T12:00:00.000Z",
        blockedByUnresolvedSettlements: 1,
        unresolvedLineCount: 1,
      },
    ]);
    render(createElement(FoxpostSettlementsPage));

    const download = await screen.findByRole("button", {
      name: "XLSX letöltése",
    });
    expect(download).toBeEnabled();
    expect(
      screen.getByText(/1 ellenőrzendő tétel a külön munkalapon/),
    ).toBeInTheDocument();
    fireEvent.click(download);
    expect(api.downloadReport).toHaveBeenCalled();
  });

  it("accepts an invoice number from the Foxpost reference and approves the row", async () => {
    const unresolvedDetail = {
      ...settlements.items[0],
      gmailMessageId: "gmail-message-1",
      xlsxFileName: "foxpost.xlsx",
      pdfFileName: "FX01015386.pdf",
      status: "NEEDS_REVIEW" as const,
      matchedLineCount: 0,
      unresolvedLineCount: 1,
      lines: [
        {
          id: "line-1",
          sourceRowNumber: 14,
          referenceCode: "ACRW-2026/00400",
          transactionDate: "2026-07-09T00:00:00.000Z",
          recipientName: "Kovács András",
          parcelBarcode: "CLFOX123",
          collectedAmount: "4000",
          status: "ORDER_NOT_FOUND" as const,
          errorCode: "FOXPOST_UNAS_ORDER_NOT_FOUND",
          updatedAt: "2026-08-15T08:00:00.000Z",
        },
      ],
    };
    api.detail.mockResolvedValue(unresolvedDetail);
    api.approveLine.mockResolvedValue({
      settlement: {
        ...unresolvedDetail,
        status: "COMPLETED",
        matchedLineCount: 1,
        unresolvedLineCount: 0,
        lines: [
          {
            ...unresolvedDetail.lines[0],
            invoiceNumber: "ACRW-2026/00400",
            resolutionSource: "MANUAL",
            status: "MATCHED",
            errorCode: undefined,
            manualApprovedAt: "2026-08-15T09:00:00.000Z",
            manualApprovedByUserId: "owner",
            manualApprovedByDisplayName: "Acropora Tulajdonos",
            updatedAt: "2026-08-15T09:00:00.000Z",
          },
        ],
      },
      reportRegenerated: true,
    });

    render(createElement(FoxpostSettlementsPage));
    fireEvent.click(await screen.findByText("26H31"));
    const invoiceInput = await screen.findByRole("textbox", {
      name: "Számlaszám – ACRW-2026/00400",
    });
    expect(invoiceInput).toHaveValue("ACRW-2026/00400");
    fireEvent.click(screen.getByRole("button", { name: "Jóváhagyás" }));

    expect(api.approveLine).toHaveBeenCalledWith(
      "token-owner",
      "settlement-1",
      "line-1",
      {
        invoiceNumber: "ACRW-2026/00400",
        expectedUpdatedAt: "2026-08-15T08:00:00.000Z",
      },
    );
    expect(
      await screen.findByText(/A tétel jóváhagyva, az elszámolás elkészült/),
    ).toBeInTheDocument();
  });
});
