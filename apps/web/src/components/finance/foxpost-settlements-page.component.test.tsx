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
});
