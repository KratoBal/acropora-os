import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import {
  finalLineOfQuoteItem,
  quoteBasisFrom,
  finalInvoiceNoticeOf,
  finalLinesSource,
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
  otherProformaMilestones: 0,
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

  it("carries the number of the quote's other proforma milestones", () => {
    const basis = quoteBasisFrom(
      milestone({ otherProformaMilestones: 2 }),
      [],
      [item("a", "Akvárium")],
    );
    assert.equal(basis?.otherProformaMilestones, 2);
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

describe("finalLinesSource", () => {
  const items = [
    {
      name: "Akvárium",
      quantity: d("1"),
      unit: "db",
      unitNetPrice: d("1000"),
      vatRatePercent: d("27"),
    },
  ];
  const basis = (
    percent: string,
    over: Partial<QuoteBasis> = {},
  ): QuoteBasis => ({
    quoteNumber: "AJ-2026-0015",
    percent: d(percent),
    items,
    otherProformaMilestones: 0,
    ...over,
  });

  it("a milestone below 100 percent with no other proforma milestone uses the quote's items", () => {
    for (const percent of ["60", "99.99"]) {
      const source = finalLinesSource(basis(percent));
      assert.equal(source.kind, "QUOTE", percent);
      if (source.kind === "QUOTE") assert.deepEqual(source.items, items);
    }
  });

  it("100 percent or no tie keeps the proforma's items", () => {
    assert.deepEqual(finalLinesSource(basis("100")), { kind: "PROFORMA" });
    assert.deepEqual(finalLinesSource(null), { kind: "PROFORMA" });
  });

  it("another milestone of the quote that already has a proforma: an empty draft, neither the percentage line nor the full items", () => {
    assert.deepEqual(
      finalLinesSource(basis("30", { otherProformaMilestones: 1 })),
      { kind: "EMPTY", reason: "MULTIPLE_ADVANCES" },
    );
    // the closing part with no proforma yet does not count (counted by the store, here it is 0)
    assert.equal(
      finalLinesSource(basis("30", { otherProformaMilestones: 0 })).kind,
      "QUOTE",
    );
  });

  it("a tied quote with no accepted items is refused, but the multiple-advance case is decided first", () => {
    const source = finalLinesSource(basis("60", { items: [] }));
    assert.equal(source.kind, "REFUSED");
    assert.deepEqual(
      finalLinesSource(basis("60", { items: [], otherProformaMilestones: 2 })),
      { kind: "EMPTY", reason: "MULTIPLE_ADVANCES" },
    );
  });
});

describe("finalInvoiceNoticeOf", () => {
  it("only the multiple-advance case has a notice, and it names the reason and what to put on the invoice", () => {
    const notice = finalInvoiceNoticeOf({
      kind: "EMPTY",
      reason: "MULTIPLE_ADVANCES",
    });
    assert.equal(notice?.code, "MULTIPLE_ADVANCES");
    assert.match(notice!.message, /több előleg-mérföldköve van díjbekérővel/);
    assert.match(notice!.message, /még nem kiszámlázott rész/);
    // a szöveg a tényt és a teendőt mondja, NEM a tételek állapotát: olvasáskor számított, egy teljes tételekkel készült vázlaton is megjelenhet
    assert.doesNotMatch(notice!.message, /üresen|üres/);
    for (const source of [
      { kind: "PROFORMA" as const },
      { kind: "QUOTE" as const, items: [] },
      { kind: "REFUSED" as const, message: "x" },
    ])
      assert.equal(finalInvoiceNoticeOf(source), null, source.kind);
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
