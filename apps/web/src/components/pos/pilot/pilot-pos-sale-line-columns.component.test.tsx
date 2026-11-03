import { render, screen } from "@testing-library/react";
import { PilotDataTable } from "@acropora/ui";
import type { PosSaleDetail } from "@acropora/types";
import { describe, expect, it, vi } from "vitest";

import {
  SALE_LINE_COLUMNS,
  SALE_LINE_TABLE_MIN_WIDTH,
} from "./pilot-pos-sale-detail-page";

vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));

/*
  AZ ELADÁS TÉTELEI A KÖZÖS TÁBLÁN (UI-áttekintés, 3. csomag, 2026-11-03). MI PIROSÍT: ha egy
  oszlop elveszti a feliratát (telefonon a cella felirat nélkül maradna), ha a kedvezmény nélküli
  tétel nem "—"-t mutat, vagy ha a fix szélességek összege nem fér a tábla minimális szélességébe
  (a régi, százalékos tábla telefonon pont ettől vált olvashatatlanná).
*/
const line: PosSaleDetail["lines"][number] = {
  id: "line-1",
  variantId: "variant-1",
  sku: "RS-RM500",
  productName: "Red Sea ReefMat 500",
  quantity: "2",
  unit: "db",
  unitNet: "19606.3",
  taxRate: "27",
  discountPercent: null,
  lineGross: "49800",
  syncStatus: "OK",
  syncError: null,
} as PosSaleDetail["lines"][number];

describe("SALE_LINE_COLUMNS", () => {
  it("labels every cell with its column for the phone card view", () => {
    render(
      <PilotDataTable
        columns={SALE_LINE_COLUMNS}
        rows={[line]}
        rowKey={(row) => row.id}
        rowTestId="pos-sale-line-row"
        minWidth={SALE_LINE_TABLE_MIN_WIDTH}
      />,
    );
    const row = screen.getAllByTestId("pos-sale-line-row")[0]!;
    const labels = [...row.querySelectorAll("td")].map((td) =>
      td.getAttribute("data-label"),
    );
    expect(labels).toEqual([
      "Cikkszám",
      "Termék",
      "Menny.",
      "Nettó egységár",
      "ÁFA",
      "Kedvezmény",
      "Bruttó",
      "UNAS szinkron",
    ]);
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("leaves the flexible product column at least 180 px at the table minimum", () => {
    const sum = SALE_LINE_COLUMNS.map((column) =>
      Number.parseInt(column.width ?? "0", 10),
    ).reduce((a, b) => a + b, 0);
    // The product name is the one flexible column: at the minimum it still needs room.
    expect(sum + 180).toBeLessThanOrEqual(SALE_LINE_TABLE_MIN_WIDTH);
  });

  it("lets a long product name wrap inside its column", () => {
    render(
      <PilotDataTable
        columns={SALE_LINE_COLUMNS}
        rows={[{ ...line, productName: "Hosszú".repeat(30) }]}
        rowKey={(row) => row.id}
        minWidth={SALE_LINE_TABLE_MIN_WIDTH}
      />,
    );
    const name = screen.getByText("Hosszú".repeat(30));
    expect(name.classList.contains("break-words")).toBe(true);
  });
});
