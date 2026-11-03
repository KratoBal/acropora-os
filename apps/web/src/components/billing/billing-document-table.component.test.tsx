import { describe, expect, it, vi } from "vitest";

// The table's imports reach the Inter font loader, which only runs inside Next.
vi.mock("next/font/local", () => ({
  default: () => ({ className: "font-inter", variable: "--font-inter" }),
}));

import {
  BILLING_CUSTOMER_MIN_WIDTH,
  BILLING_DOCUMENT_COLUMNS,
  BILLING_TABLE_MIN_WIDTH,
} from "./billing-document-table";

/*
  A SZÁMLÁZÁS ASZTALI TÁBLÁJA (UI-áttekintés, stage-fotó 2026-11-03, 1440 px). MI PIROSÍT:
  ha a rögzített szélességű oszlopok összege annyit hagy a Vevő oszlopnak, hogy az nullára
  zsugorodik (a fejléce ráfutott a "Kiállítás" fejlécre, az adata eltűnt); ha a Vevő oszlop
  kap rögzített szélességet (akkor nincs, ami a maradékot elvigye); ha a kiállítás dátuma
  megint két sorba törhet ("2026. 10." és "06.").
*/
const fixed = BILLING_DOCUMENT_COLUMNS.filter((c) => c.id !== "customer");
const px = (width: string | undefined) => {
  const m = /^(\d+)px$/.exec(width ?? "");
  if (!m) throw new Error(`nem px szélesség: ${width}`);
  return Number(m[1]);
};

describe("a számlázási tábla oszlopszélességei", () => {
  it("a rögzített oszlopok mellett a Vevő oszlopnak marad legalább a minimuma", () => {
    const sum = fixed.reduce((acc, c) => acc + px(c.width), 0);
    expect(sum + BILLING_CUSTOMER_MIN_WIDTH).toBeLessThanOrEqual(
      BILLING_TABLE_MIN_WIDTH,
    );
  });

  it("a Vevő az egyetlen rugalmas oszlop", () => {
    const customer = BILLING_DOCUMENT_COLUMNS.find((c) => c.id === "customer");
    expect(customer?.width).toBeUndefined();
    expect(fixed.every((c) => c.width !== undefined)).toBe(true);
  });

  it("mindkét dátumoszlop egy sorban marad", () => {
    for (const id of ["issueDate", "dueDate"]) {
      expect(
        BILLING_DOCUMENT_COLUMNS.find((c) => c.id === id)?.nowrap,
        id,
      ).toBe(true);
    }
  });
});
