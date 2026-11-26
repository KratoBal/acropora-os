import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { StockItemReconciliationSection } from "./stock-item-reconciliation-section";

const api = vi.hoisted(() => ({ page: vi.fn(), summary: vi.fn() }));

vi.mock("@/lib/api/inventory", () => ({ stockItemReconciliationApi: api }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: {
      token: "token-1",
      user: { id: "user-1", email: "b@acropora.local", role: "OWNER" },
    },
  }),
}));

const row = (overrides: Record<string, unknown> = {}) => ({
  variantId: "v1",
  sku: "ACR-001",
  warehouseId: "w1",
  warehouseCode: "FO",
  ledgerProvable: true,
  ledgerExpectedOnHand: "5",
  localOnHand: "3",
  unasOnHand: "3",
  localVsLedgerDelta: "-2",
  unasVsLocalDelta: "0",
  status: "LOCAL_VS_LEDGER_MISMATCH",
  notes: [],
  ...overrides,
});

beforeEach(() => {
  api.page.mockReset().mockResolvedValue({
    items: [],
    page: 1,
    pageSize: 25,
    totalItems: 0,
    totalPages: 0,
  });
  api.summary.mockReset().mockResolvedValue({
    checkedAt: "2026-09-01T18:00:00.000Z",
    checkedCount: 0,
    byStatus: {},
  });
});

describe("the itemised reconciliation nobody could see", () => {
  /**
   * EZ A SZEKCIÓ AZÉRT LÉTEZIK: mérve 2026-09-01-én, a felület a MÁSIK
   * összevetést mutatta („készlet-egyeztetés" néven), és a javító végpontok
   * ehhez tartoznak. Aki ránézett az oldalra, azt hihette, hogy már látja, amit
   * valójában soha nem kértünk le.
   */
  it("asks for the itemised comparison, not just the summary report", async () => {
    render(<StockItemReconciliationSection />);

    await waitFor(() => expect(api.page).toHaveBeenCalledTimes(1));
    expect(api.summary).toHaveBeenCalledTimes(1);
  });

  it("shows a row with the ledger figure beside the local one", async () => {
    api.page.mockResolvedValue({
      items: [row()],
      page: 1,
      pageSize: 25,
      totalItems: 1,
      totalPages: 1,
    });

    render(<StockItemReconciliationSection />);

    await waitFor(() => expect(screen.getByText("ACR-001")).toBeTruthy());
    expect(screen.getByText("LOCAL_VS_LEDGER_MISMATCH")).toBeTruthy();
  });

  /**
   * A NEM BIZONYÍTHATÓ VÁRT ÉRTÉKET KI KELL ÍRNI.
   *
   * A szerver `null`-t ad, ha a főkönyvből nem vezethető le -- és egy üres
   * cella tévedésből EGYEZÉSNEK látszik. Ez ugyanaz a hiba, mint amikor egy
   * hiba üres listaként jelenik meg: a hiányzó tudás megnyugtatásnak öltözik.
   */
  it("names an unprovable ledger figure instead of leaving the cell blank", async () => {
    api.page.mockResolvedValue({
      items: [row({ ledgerProvable: false, ledgerExpectedOnHand: null })],
      page: 1,
      pageSize: 25,
      totalItems: 1,
      totalPages: 1,
    });

    render(<StockItemReconciliationSection />);

    await waitFor(() =>
      expect(screen.getByText("nem bizonyítható")).toBeTruthy(),
    );
  });

  /**
   * ÉS A HIBA NEM ÜRES LISTAKÉNT JELENIK MEG.
   *
   * „Nincs eltérés" és „nem tudjuk, van-e" két különböző dolog, és a második
   * megnyugtatna valakit, akinek nem kellene. Ez a nap egyik visszatérő
   * lelete, csak most a készlet oldalán.
   */
  it("says the load failed instead of claiming there is nothing to fix", async () => {
    api.page.mockRejectedValue(new Error("hálózati hiba"));

    render(<StockItemReconciliationSection />);

    await waitFor(() =>
      expect(
        screen.getByText("A tételes összevetés nem tölthető be"),
      ).toBeTruthy(),
    );
    expect(screen.queryByText(/Nincs tételes eltérés/)).toBeNull();
  });

  /**
   * LAPOZÁS (Picasso 3.27): eddig csak az első 25 sor látszott, a többi "a következő kör" volt. A lapozó a szervertől kéri a következő oldalt, nem a már letöltött sorokat szeleteli.
   */
  it("pages through the itemised rows by asking the server for the next page", async () => {
    api.page.mockImplementation(
      async (_token: string, query: { page?: number }) => ({
        items: [
          row({
            sku: `ACR-P${query.page ?? 1}`,
            variantId: `v${query.page ?? 1}`,
          }),
        ],
        page: query.page ?? 1,
        pageSize: 25,
        totalItems: 60,
        totalPages: 3,
      }),
    );
    render(<StockItemReconciliationSection />);
    await waitFor(() => expect(screen.getByText("ACR-P1")).toBeTruthy());
    expect(api.page).toHaveBeenLastCalledWith(
      "token-1",
      { page: 1, pageSize: 25 },
      expect.anything(),
    );
    const pager = screen.getByRole("navigation", { name: /Lapozás/ });
    fireEvent.click(within(pager).getByRole("button", { name: /Következő/ }));
    await waitFor(() => expect(screen.getByText("ACR-P2")).toBeTruthy());
    expect(api.page).toHaveBeenLastCalledWith(
      "token-1",
      { page: 2, pageSize: 25 },
      expect.anything(),
    );
    expect(screen.getByText("2. oldal: 1 sor, összesen 60.")).toBeTruthy();
  });
});
