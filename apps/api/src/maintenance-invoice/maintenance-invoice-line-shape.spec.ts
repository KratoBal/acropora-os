import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import { sameLineShape } from "./maintenance-invoice-line-shape.js";

/**
 * A PISZKOZAT SORAINAK ALAKJA A MOST KIÁLLÍTANDÓ TÉTELEKKEL (barracuda L7). Mi pirosít: ha az egység, a mennyiség vagy az egységár
 * eltérése átmegy; ha a sorrend számít; ha az üres tárolt egység egyezik a kiment egységgel; ha a "2" és a "2.000000" különbözik; ha a
 * sorok száma eltér, mégis egyezik.
 */
const D = (value: string | number) => new Prisma.Decimal(value);
const stored = (overrides: Record<string, unknown> = {}) => ({
  description: "A",
  quantity: D("2.000000"),
  unit: "alkalom" as string | null,
  unitNet: D("450000.0000"),
  ...overrides,
});
const sent = (overrides: Record<string, unknown> = {}) => ({
  name: "A",
  quantity: 2,
  unit: "alkalom",
  netUnitPrice: 450000,
  ...overrides,
});

describe("sameLineShape", () => {
  it("matches the stored decimals with the sent numbers", () => {
    assert.equal(sameLineShape([stored()], [sent()]), true);
  });

  it("is false when the unit, the quantity or the unit price differs", () => {
    assert.equal(sameLineShape([stored({ unit: "db" })], [sent()]), false);
    assert.equal(sameLineShape([stored({ unit: null })], [sent()]), false);
    assert.equal(sameLineShape([stored({ quantity: D(1) })], [sent()]), false);
    assert.equal(
      sameLineShape([stored({ unitNet: D("900000") })], [sent()]),
      false,
    );
  });

  it("does not depend on the order of the lines, and a different count never matches", () => {
    const a = stored();
    const b = stored({
      description: "B",
      quantity: D(3),
      unitNet: D("3333.3333"),
    });
    assert.equal(
      sameLineShape(
        [a, b],
        [sent({ name: "B", quantity: 3, netUnitPrice: 3333.3333 }), sent()],
      ),
      true,
    );
    assert.equal(sameLineShape([a, b], [sent()]), false);
    assert.equal(sameLineShape([], []), true);
  });
});
