import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import {
  finalLineOfQuoteItem,
  quoteBasisFrom,
  usesQuoteLines,
  type MilestoneRow,
  type QuoteBasis,
  type QuoteItemRow,
} from "./billing-final-lines.js";

/**
 * A VÉGSZÁMLA TÉTELEI AZ AJÁNLATBÓL (kártya 2650d371). MI PIROSÍT: ha egy mérföldkő nem az ELFOGADOTT verzión is alapot adna; ha egy
 * opcionális tétel, amit az elfogadó NEM kért, a végszámlára kerülne (vagy egy kért kimaradna); ha az ajánlat sorrendje felborulna; ha a
 * 100%-os (teljes ellenértékű) mérföldkő is az ajánlat tételeit használná; ha az ajánlat-sor termékhez vagy variánshoz kötve menne
 * (a kiállításkor készletet mozgatna).
 */
const d = (value: string) => new Prisma.Decimal(value);

const milestone = (over: Partial<MilestoneRow> = {}): MilestoneRow => ({
  percent: d("60"),
  versionId: "v2",
  quote: { quoteNumber: "AJ-2026-0015", acceptedVersionId: "v2" },
  ...over,
});

const item = (
  id: string,
  name: string,
  over: Partial<QuoteItemRow> = {},
): QuoteItemRow => ({
  id,
  name,
  isOptional: false,
  quantity: d("1"),
  unit: "db",
  unitNetPrice: d("1000"),
  vatRatePercent: d("27"),
  ...over,
});

describe("quoteBasisFrom", () => {
  it("the accepted version's items in the quote's order, with the optional ones the customer asked for", () => {
    const basis = quoteBasisFrom(
      milestone(),
      ["opt-yes"],
      [
        item("a", "Akvárium"),
        item("opt-no", "Világítás", { isOptional: true }),
        item("opt-yes", "Szűrő", { isOptional: true }),
        item("b", "Szállítás"),
      ],
    );
    assert.ok(basis);
    assert.equal(basis.quoteNumber, "AJ-2026-0015");
    assert.equal(basis.percent.toString(), "60");
    assert.deepEqual(
      basis.items.map((i) => i.name),
      ["Akvárium", "Szűrő", "Szállítás"],
    );
  });

  it("a milestone on a version that is not the accepted one gives no basis", () => {
    assert.equal(
      quoteBasisFrom(
        milestone({
          quote: { quoteNumber: "AJ-2026-0015", acceptedVersionId: "v3" },
        }),
        [],
        [item("a", "Akvárium")],
      ),
      null,
    );
    assert.equal(
      quoteBasisFrom(
        milestone({
          quote: { quoteNumber: "AJ-2026-0015", acceptedVersionId: null },
        }),
        [],
        [item("a", "Akvárium")],
      ),
      null,
    );
  });
});

describe("usesQuoteLines", () => {
  const basis = (percent: string): QuoteBasis => ({
    quoteNumber: "AJ-2026-0015",
    percent: d(percent),
    items: [],
  });

  it("a milestone below 100 percent uses the quote's lines; 100 percent or no tie keeps the proforma's", () => {
    assert.equal(usesQuoteLines(basis("60")), true);
    assert.equal(usesQuoteLines(basis("99.99")), true);
    assert.equal(usesQuoteLines(basis("100")), false);
    assert.equal(usesQuoteLines(null), false);
  });
});

describe("finalLineOfQuoteItem", () => {
  it("carries the item's name, quantity, unit, net price and VAT rate, with no product link", () => {
    assert.deepEqual(
      finalLineOfQuoteItem(
        item("a", "Akvárium", {
          quantity: d("2.500000"),
          unitNetPrice: d("1234.5000"),
          vatRatePercent: d("5.00"),
        }),
      ),
      {
        productId: null,
        description: "Akvárium",
        quantity: "2.5",
        unit: "db",
        unitNet: "1234.5",
        vatRatePercent: "5",
        discountPercent: null,
        comment: null,
      },
    );
  });
});
