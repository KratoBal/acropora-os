import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@acropora/database";

import {
  orderTotals,
  selectOrderItems,
  type QuoteItemSource,
} from "./partner-order-items.js";

function item(
  id: string,
  over: Partial<QuoteItemSource> = {},
): QuoteItemSource {
  return {
    id,
    blockPosition: 1,
    position: 1,
    name: `Tétel ${id}`,
    description: null,
    quantity: new Prisma.Decimal(1),
    unit: "db",
    unitNetPrice: new Prisma.Decimal(1000),
    vatRatePercent: new Prisma.Decimal(27),
    isOptional: false,
    ...over,
  };
}

describe("selectOrderItems", () => {
  it("keeps every non-optional line and only the chosen optional ones", () => {
    const lines = selectOrderItems(
      [
        item("a"),
        item("b", { isOptional: true, position: 2 }),
        item("c", { isOptional: true, position: 3 }),
      ],
      ["c"],
      "HUF",
    );
    assert.deepEqual(
      lines.map((l) => l.quoteItemId),
      ["a", "c"],
    );
    assert.equal(lines[1]!.wasOptional, true);
    assert.equal(lines[0]!.wasOptional, false);
  });

  it("orders by block, then by position, and renumbers from 1", () => {
    const lines = selectOrderItems(
      [
        item("late", { blockPosition: 2, position: 1 }),
        item("second", { blockPosition: 1, position: 2 }),
        item("first", { blockPosition: 1, position: 1 }),
      ],
      [],
      "HUF",
    );
    assert.deepEqual(
      lines.map((l) => [l.quoteItemId, l.position]),
      [
        ["first", 1],
        ["second", 2],
        ["late", 3],
      ],
    );
  });

  it("carries the quantity, unit and exact line amount", () => {
    const [line] = selectOrderItems(
      [
        item("a", {
          quantity: new Prisma.Decimal("2.5"),
          unit: "alkalom",
          unitNetPrice: new Prisma.Decimal("1234.56"),
        }),
      ],
      [],
      "HUF",
    );
    assert.equal(line!.quantity, "2.5");
    assert.equal(line!.unit, "alkalom");
    assert.equal(line!.netAmount, "3086.4");
    // 3086.4 net -> 3086; VAT of 3086 at 27% = 833.22 -> 833; gross 3919
    assert.deepEqual(line!.rounded, { net: "3086", vat: "833", gross: "3919" });
  });

  it("carries the certificate's rounded amounts on the line, the VAT from the rounded net", () => {
    const [line] = selectOrderItems(
      [item("a", { unitNetPrice: new Prisma.Decimal("1.5") })],
      [],
      "HUF",
    );
    assert.deepEqual(line!.rounded, { net: "2", vat: "1", gross: "3" });
  });

  it("states the rounded amounts with two decimals in another currency", () => {
    const [line] = selectOrderItems(
      [item("a", { unitNetPrice: new Prisma.Decimal("10.005") })],
      [],
      "EUR",
    );
    assert.deepEqual(line!.rounded, {
      net: "10.01",
      vat: "2.70",
      gross: "12.71",
    });
  });

  it("ignores an optional id that is not an optional line of the version", () => {
    const lines = selectOrderItems([item("a")], ["not-there"], "HUF");
    assert.deepEqual(
      lines.map((l) => l.quoteItemId),
      ["a"],
    );
  });
});

describe("orderTotals", () => {
  const line = (quantity: string, unitNetPrice: string, vat: string) => ({
    quantity,
    unitNetPrice,
    vatRatePercent: vat,
  });

  it("sums per VAT rate", () => {
    const totals = orderTotals(
      [line("1", "1000", "27"), line("1", "333", "27"), line("1", "500", "5")],
      "HUF",
    );
    // 270 + 90 (89.91) + 25
    assert.deepEqual(totals.byRate, [
      { vatRatePercent: "27", net: "1333", vat: "360", gross: "1693" },
      { vatRatePercent: "5", net: "500", vat: "25", gross: "525" },
    ]);
    assert.equal(totals.net, "1833");
    assert.equal(totals.vat, "385");
    assert.equal(totals.gross, "2218");
  });

  it("rounds per line and then adds, the way the invoice does (ADR-014)", () => {
    // three lines of 10.5 net at 27%: each line rounds to 11 net / 3 VAT / 14 gross,
    // while the exact sum is 31.5 net / 8.505 VAT, which rounds to 32 / 9 / 40.
    const lines = [
      line("1", "10.5", "27"),
      line("1", "10.5", "27"),
      line("1", "10.5", "27"),
    ];
    const totals = orderTotals(lines, "HUF");
    assert.equal(totals.net, "33");
    assert.equal(totals.vat, "9");
    assert.equal(totals.gross, "42");
    assert.notEqual(totals.net, "32");
  });

  it("takes a line's VAT from its ROUNDED net, the way the certificate does", () => {
    // 1 x 1.5 Ft at 27%: net 2; the VAT of the printed net 2 is 0.54 -> 1 (the raw net would give 0.405 -> 0); gross 3
    const totals = orderTotals([line("1", "1.5", "27")], "HUF");
    assert.equal(totals.net, "2");
    assert.equal(totals.vat, "1");
    assert.equal(totals.gross, "3");
  });

  it("adds a line's gross as its rounded net plus its rounded VAT", () => {
    // 3 x 3.5 = 10.5 -> net 11 (half up); VAT of 11 = 2.97 -> 3; gross 14, although the exact gross 13.335 rounds to 13
    const totals = orderTotals([line("3", "3.5", "27")], "HUF");
    assert.equal(totals.net, "11");
    assert.equal(totals.vat, "3");
    assert.equal(totals.gross, "14");
  });

  it("uses two decimals for a non-HUF currency", () => {
    const totals = orderTotals([line("1", "10.005", "27")], "EUR");
    assert.equal(totals.net, "10.01");
    assert.equal(totals.vat, "2.70");
    assert.equal(totals.gross, "12.71");
  });

  it("gives zeroes for no lines", () => {
    const totals = orderTotals([], "HUF");
    assert.deepEqual(totals, { net: "0", vat: "0", gross: "0", byRate: [] });
  });
});
