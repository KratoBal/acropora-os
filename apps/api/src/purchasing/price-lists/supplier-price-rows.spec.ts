import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import {
  computeSupplierPriceRows,
  type FxQuote,
  type PriceRowSource,
} from "./supplier-price-rows.js";

const NOW = new Date("2026-10-23T12:00:00.000Z");
const EUR: FxQuote = { rate: "400", quotedDate: "2026-10-23" };

const source = (overrides: Partial<PriceRowSource> = {}): PriceRowSource => ({
  supplierId: "s1",
  supplierName: "Hertlein",
  supplierSku: "A-1",
  listedName: "Example",
  unitPrice: "20",
  currency: "EUR",
  listRetailPrice: null,
  listDate: new Date("2026-10-12T00:00:00.000Z"),
  matchStatus: "APPROVED",
  matchMethod: "EAN",
  ...overrides,
});

const rows = (
  input: PriceRowSource[],
  sellingNet: string | null = "10000",
  fx: Map<string, FxQuote | null> = new Map([["EUR", EUR]]),
) =>
  computeSupplierPriceRows({
    rows: input,
    sellingNet: sellingNet === null ? null : new Prisma.Decimal(sellingNet),
    fx,
    now: NOW,
  });

/**
 * A BESZERZÉSI ÁR FORINTBAN ÉS A HASZON (task beszallitoi-arlistak-4), KÉZZEL
 * SZÁMOLT PÉLDÁKKAL. MI PIROSÍT: ha a forintár nem egységár × árfolyam; ha a haszon
 * nem a nettó eladási ár és a forint beszerzés különbsége; ha a százalék nem az
 * eladási nettó százaléka; ha a kerekítés nem fél felfelé; ha hiányzó árfolyam vagy
 * eladási ár nullát ad; ha a HUF sor árfolyamot kér; ha a sorrend nem a
 * legolcsóbbal kezdődik.
 */
describe("computeSupplierPriceRows", () => {
  it("20 EUR at 400 is 8 000 Ft; against a 10 000 Ft net selling price the profit is 2 000 Ft, 20 %", () => {
    const [row] = rows([source()]);
    assert.equal(row!.purchaseHuf, "8000.00");
    assert.equal(row!.profitHuf, "2000.00");
    assert.equal(row!.profitPercent, "20.00");
    assert.deepEqual([row!.fxRate, row!.fxDate], ["400", "2026-10-23"]);
  });

  it("rounds half up to the forint cent, and a loss is a negative number", () => {
    // 25.5 EUR x 395.37 = 10 081.935 -> 10 081.94; profit -81.935 -> -81.94; -0.8194 % -> -0.82
    const [row] = rows(
      [source({ unitPrice: "25.5" })],
      "10000",
      new Map([["EUR", { rate: "395.37", quotedDate: "2026-10-22" }]]),
    );
    assert.equal(row!.purchaseHuf, "10081.94");
    assert.equal(row!.profitHuf, "-81.94");
    assert.equal(row!.profitPercent, "-0.82");
  });

  it("a forint list needs no exchange rate: 9 000 Ft against 10 000 Ft net is 1 000 Ft, 10 %", () => {
    const [row] = rows(
      [source({ currency: "HUF", unitPrice: "9000" })],
      "10000",
      new Map(),
    );
    assert.deepEqual(
      [
        row!.purchaseHuf,
        row!.profitHuf,
        row!.profitPercent,
        row!.fxRate,
        row!.fxDate,
      ],
      ["9000.00", "1000.00", "10.00", "1", null],
    );
  });

  it("gives no forint price and no profit when the exchange rate is missing, never a zero", () => {
    const [row] = rows([source()], "10000", new Map([["EUR", null]]));
    assert.deepEqual(
      [row!.purchaseHuf, row!.profitHuf, row!.profitPercent, row!.fxRate],
      [null, null, null, null],
    );
    assert.equal(row!.unitPrice, "20");
  });

  it("gives the forint price but no profit when there is no selling price", () => {
    const [row] = rows([source()], null);
    assert.deepEqual(
      [row!.purchaseHuf, row!.profitHuf, row!.profitPercent],
      ["8000.00", null, null],
    );
  });

  it("gives no percent when the selling price is zero (no division by zero), but the profit stays", () => {
    const [row] = rows([source()], "0");
    assert.deepEqual([row!.profitHuf, row!.profitPercent], ["-8000.00", null]);
  });

  it("orders the cheapest purchase first, the rows without a forint price last, then by supplier name", () => {
    const ordered = rows(
      [
        source({
          supplierSku: "pricey",
          supplierName: "Zeta",
          unitPrice: "30",
        }),
        source({ supplierSku: "nofx", supplierName: "Alfa", currency: "USD" }),
        source({ supplierSku: "cheap", supplierName: "Beta", unitPrice: "10" }),
        source({ supplierSku: "tie", supplierName: "Alfa", unitPrice: "30" }),
      ],
      "10000",
      new Map([
        ["EUR", EUR],
        ["USD", null],
      ]),
    );
    assert.deepEqual(
      ordered.map((row) => row.supplierSku),
      ["cheap", "tie", "pricey", "nofx"],
    );
  });

  it("counts the age of the list in whole days and keeps the match flag for the display", () => {
    const [row] = rows([
      source({ matchStatus: "AUTO", matchMethod: "SUPPLIER_CODE" }),
    ]);
    assert.equal(row!.listDate, "2026-10-12");
    assert.equal(row!.listAgeDays, 11);
    assert.deepEqual(
      [row!.matchStatus, row!.matchMethod],
      ["AUTO", "SUPPLIER_CODE"],
    );
  });
});
