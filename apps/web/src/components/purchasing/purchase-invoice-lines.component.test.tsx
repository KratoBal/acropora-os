import { render, screen } from "@testing-library/react";
import { PilotDataTable } from "@acropora/ui";
import type { PurchaseInvoiceDetail } from "@acropora/types";
import { describe, expect, it, vi } from "vitest";

import {
  PURCHASE_LINE_TABLE_MIN_WIDTH,
  purchaseLineColumns,
  purchaseSyncLabel,
} from "./purchase-invoice-detail-page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => "/beszerzes/inv-1",
  useSearchParams: () => new URLSearchParams(),
}));

/*
  A SZÁMLA TÉTELEI A KÖZÖS TÁBLÁN (UI-áttekintés, 3. csomag, 2026-11-03). MI PIROSÍT: ha egy oszlop
  elveszti a feliratát (telefonon a cella felirat nélkül maradna), ha a terméktörzsben nem szereplő
  tétel jelzése eltűnik, ha a pénznem nem a számláé, vagy ha a fix szélességek mellett a rugalmas
  Termék oszlopnak nem marad 200 px a minimumon.
*/
type Line = PurchaseInvoiceDetail["lines"][number];

const line = {
  id: "line-1",
  sku: "SKU-1",
  variantId: "variant-1",
  productName: "Teszt termék",
  sourceDescription: null,
  orderedQuantity: "5",
  actualQuantity: "4",
  unit: "db",
  warehouseQuantity: "4",
  projectAllocations: [],
  unitNet: "1200",
  discountPercent: null,
  lineNet: "4800",
  syncStatus: "OK",
  syncError: null,
} as unknown as Line;

function renderLines(lines: Line[], currency = "HUF") {
  return render(
    <PilotDataTable
      columns={purchaseLineColumns(currency)}
      rows={lines}
      rowKey={(row) => row.id}
      rowTestId="purchase-line-row"
      minWidth={PURCHASE_LINE_TABLE_MIN_WIDTH}
    />,
  );
}

describe("purchaseLineColumns", () => {
  it("labels every cell with its column for the phone card view", () => {
    renderLines([line]);
    const row = screen.getAllByTestId("purchase-line-row")[0]!;
    const labels = [...row.querySelectorAll("td")].map((td) =>
      td.getAttribute("data-label"),
    );
    expect(labels).toEqual([
      "Cikkszám",
      "Termék",
      "Rendelt",
      "Tényleges",
      "Projektkészlet",
      "Egységár",
      "Kedvezmény",
      "Nettó sorérték",
      "UNAS szinkron",
    ]);
  });

  it("shows the invoice currency and a dash for no discount", () => {
    renderLines([line], "EUR");
    expect(screen.getByText(/4\s?800\s+EUR/)).toBeTruthy();
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("flags a line that is not in the product master", () => {
    renderLines([
      {
        ...line,
        variantId: null,
        sku: null,
        sourceDescription: "Ismeretlen áru",
      } as Line,
    ]);
    expect(screen.getByText("Nincs terméktörzsben")).toBeTruthy();
    expect(screen.getByText("Ismeretlen áru")).toBeTruthy();
  });

  it("shows the sync error under the badge", () => {
    renderLines([
      { ...line, syncStatus: "FAILED", syncError: "UNAS nem elérhető" } as Line,
    ]);
    expect(screen.getByText("Hiba")).toBeTruthy();
    expect(screen.getByText("UNAS nem elérhető")).toBeTruthy();
  });

  it("leaves the flexible product column at least 200 px at the table minimum", () => {
    const sum = purchaseLineColumns("HUF")
      .map((column) => Number.parseInt(column.width ?? "0", 10))
      .reduce((a, b) => a + b, 0);
    expect(sum + 200).toBeLessThanOrEqual(PURCHASE_LINE_TABLE_MIN_WIDTH);
  });
});

describe("purchaseSyncLabel", () => {
  it("names every sync state", () => {
    expect(purchaseSyncLabel("OK")).toBe("OK");
    expect(purchaseSyncLabel("FAILED")).toBe("Hiba");
    expect(purchaseSyncLabel("NOT_LINKED")).toBe("Nincs szinkronizálva");
    expect(purchaseSyncLabel("NOT_APPLICABLE")).toBe("Nem UNAS-termék");
    expect(purchaseSyncLabel("PENDING")).toBe("Függőben");
  });
});
