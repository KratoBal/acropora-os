import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CashRegisterReceiptListResponse } from "@acropora/types";
import { BillingReceiptsView } from "./billing-receipts-view";
const api = vi.hoisted(() => ({
  cashRegisterReceipts: vi.fn(),
  receipts: vi.fn(),
}));
vi.mock("@/lib/api/billing-documents", () => ({ billingDocumentsApi: api }));
const data: CashRegisterReceiptListResponse = {
  day: "2026-10-03",
  page: 1,
  pageSize: 50,
  total: 1,
  items: [
    {
      id: "1",
      apNumber: "A01413081",
      receiptNumber: "2820/00001",
      issuedAt: "2026-10-03T08:32:46Z",
      total: "2000",
      paymentMeans: "CARD",
      cancelled: false,
      kind: "SALE",
      validationCode: "WARN",
      lines: [{ name: "GYŰJTŐ 1", quantity: "1", sum: "2000", vatCode: "C00" }],
    },
  ],
  summary: {
    count: 7,
    total: "469890",
    payments: [
      { category: "CARD", amount: "458090" },
      { category: "CASH", amount: "11800" },
    ],
  },
  gaps: [
    {
      apNumber: "A01413081",
      fromFileNumber: 11576,
      toFileNumber: 11577,
      detectedAt: "2026-10-05T08:00:00Z",
      reason: "NAV_RETENTION_EXPIRED",
    },
  ],
  lastRun: {
    status: "SUCCEEDED",
    startedAt: "2026-10-05T08:00:00Z",
    completedAt: "2026-10-05T08:01:00Z",
    errorCode: null,
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  api.cashRegisterReceipts.mockResolvedValue(data);
  api.receipts.mockResolvedValue({ received: 3, items: [] });
});
describe("cash-register receipts view", () => {
  it("has a separate source, exact full-day totals, visible missing range, local time and raw lines", async () => {
    render(<BillingReceiptsView token="test" />);
    expect(await screen.findByText("2820/00001")).toBeInTheDocument();
    expect(screen.getByText("469 890 Ft")).toBeInTheDocument();
    expect(screen.getByText("458 090 Ft")).toBeInTheDocument();
    expect(screen.getByText("11 800 Ft")).toBeInTheDocument();
    expect(screen.getByText(/11576–11577/)).toBeInTheDocument();
    expect(screen.getByText(/10:32/)).toBeInTheDocument();
    expect(screen.getByText("NAV figyelmeztetés")).toBeInTheDocument();
    expect(api.receipts).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Nyugták napja"), {
      target: { value: "2026-10-03" },
    });
    await waitFor(() =>
      expect(api.cashRegisterReceipts).toHaveBeenLastCalledWith(
        "test",
        "2026-10-03",
        1,
        expect.any(AbortSignal),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Számlázz.hu" }));
    expect(
      await screen.findByText("3 nyugta érkezett az adatkapcsolaton"),
    ).toBeInTheDocument();
  });
  it("retries failures and displays cancelled/storno/return without hiding the daily balance", async () => {
    api.cashRegisterReceipts.mockRejectedValueOnce(new Error("Offline"));
    api.cashRegisterReceipts.mockResolvedValueOnce({
      ...data,
      items: [
        { ...data.items[0]!, id: "a", cancelled: true },
        { ...data.items[0]!, id: "b", kind: "STORNO", total: "-2000" },
        { ...data.items[0]!, id: "c", kind: "RETURN", total: "-1000" },
      ],
      lastRun: {
        ...data.lastRun!,
        status: "FAILED",
        errorCode: "OPG_FILE_GAP",
      },
    });
    render(<BillingReceiptsView token="test" />);
    expect(await screen.findByText("Offline")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Újrapróbálás" }));
    expect(await screen.findByText("Törölt")).toBeInTheDocument();
    expect(screen.getByText("Sztornó")).toBeInTheDocument();
    expect(screen.getByText("Visszáru")).toBeInTheDocument();
    expect(screen.getByText(/Hibakód: OPG_FILE_GAP/)).toBeInTheDocument();
  });
});
