import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  MISMATCH_PAGE_SIZE,
  StockReconciliationPage,
} from "./stock-reconciliation-page";

/*
  KÉSZLET-EGYEZTETÉS, AZ UNAS-RENDELÉSEK FELŐL (Picasso 3.27, acrobot 62208): a teszten 245 eltérés egyetlen lapon, 11 700 px magas oldal. MI PIROSÍT: ha a riport újra minden sort kirajzol; ha a lapozó
  nem lép; ha a számláló nem mondja meg, hányadik sortól hányadikig látszik; ha egy lap alatti riportnál (egy oldal) lapozó áll.
*/
const api = vi.hoisted(() => ({ checkStockReconciliation: vi.fn() }));
vi.mock("@/lib/api/unas-orders", () => ({ unasOrdersApi: api }));
vi.mock("./stock-item-reconciliation-section", () => ({
  StockItemReconciliationSection: () => null,
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: {
      token: "token-1",
      user: { id: "u", email: "b@acropora.local", role: "OWNER" },
    },
  }),
}));

const mismatch = (n: number) => ({
  variantId: `v${n}`,
  sku: `SKU-${String(n).padStart(3, "0")}`,
  productName: `Termék ${n}`,
  localOnHand: "3",
  unasReportedStock: "5",
  difference: "-2",
  reportedStockSyncedAt: null,
});
const report = (count: number) => ({
  checkedAt: "2026-11-26T00:00:00.000Z",
  checkedCount: 1000,
  mismatches: Array.from({ length: count }, (_, i) => mismatch(i + 1)),
});

beforeEach(() => {
  api.checkStockReconciliation.mockReset();
});

describe("StockReconciliationPage", () => {
  it("shows one page of the mismatches, with the range and the total", async () => {
    api.checkStockReconciliation.mockResolvedValue(report(60));
    render(<StockReconciliationPage />);
    await screen.findByText("SKU-001");
    expect(screen.getAllByRole("row")).toHaveLength(MISMATCH_PAGE_SIZE + 1);
    expect(screen.queryByText("SKU-026")).toBeNull();
    expect(screen.getByText(/1\s*–\s*25\s*\/\s*60 eltérés/)).toBeTruthy();
  });

  it("the pager moves to the next page and its rows", async () => {
    api.checkStockReconciliation.mockResolvedValue(report(60));
    render(<StockReconciliationPage />);
    await screen.findByText("SKU-001");
    const pager = screen.getByRole("navigation", { name: /Lapozás/ });
    fireEvent.click(within(pager).getByRole("button", { name: /Következő/ }));
    expect(await screen.findByText("SKU-026")).toBeTruthy();
    expect(screen.queryByText("SKU-001")).toBeNull();
    expect(screen.getByText(/26\s*–\s*50\s*\/\s*60 eltérés/)).toBeTruthy();
  });

  it("the last page is shorter and shows its own range", async () => {
    api.checkStockReconciliation.mockResolvedValue(report(60));
    render(<StockReconciliationPage />);
    await screen.findByText("SKU-001");
    const pager = screen.getByRole("navigation", { name: /Lapozás/ });
    fireEvent.click(within(pager).getByRole("button", { name: /Következő/ }));
    fireEvent.click(within(pager).getByRole("button", { name: /Következő/ }));
    expect(await screen.findByText("SKU-060")).toBeTruthy();
    expect(screen.getByText(/51\s*–\s*60\s*\/\s*60 eltérés/)).toBeTruthy();
  });

  it("a report that fits one page has no pager", async () => {
    api.checkStockReconciliation.mockResolvedValue(report(5));
    render(<StockReconciliationPage />);
    await screen.findByText("SKU-005");
    expect(screen.queryByRole("navigation", { name: /Lapozás/ })).toBeNull();
  });
});
