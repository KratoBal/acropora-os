import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  checkDoseEntry,
  type DoseContext,
  type DoseEntry,
  type LinkedRecommendation,
} from "./reefclub-dose-rules.js";

/**
 * WHAT THE CUSTOMER MAY RECORD AS GIVEN (ReefClub slice 8, the dose PR). Made-up
 * data. The base case: 200 litres, 8 ml of a KH product recommended an hour ago
 * and recorded now, as recommended.
 */
const NOW = new Date("2026-10-21T12:00:00.000Z");
const HOUR = 3_600_000;
const ago = (hours: number) => new Date(NOW.getTime() - hours * HOUR);

const recommendation = (
  over: Partial<LinkedRecommendation> = {},
): LinkedRecommendation => ({
  id: "rec-1",
  parameterCode: "KH",
  productId: "p-kh",
  amount: 8,
  unit: "ML",
  createdAt: ago(1),
  status: "OPEN",
  ...over,
});

const entry = (over: Partial<DoseEntry> = {}): DoseEntry => ({
  parameter: "KH",
  productId: "p-kh",
  amount: 8,
  unit: "ML",
  administeredAt: ago(0.5),
  recommendationId: "rec-1",
  confirmed: false,
  ...over,
});

const context = (over: Partial<DoseContext> = {}): DoseContext => ({
  now: NOW,
  volumeLiters: 200,
  knownProductIds: new Set(["p-kh"]),
  row: { direction: "EMEL", effectPer100L: 0.25, maxDailyDosePer100L: 20 },
  recommendation: recommendation(),
  ...over,
});

function refusedCode(e: Partial<DoseEntry>, c: Partial<DoseContext> = {}) {
  const result = checkDoseEntry(entry(e), context(c));
  assert.equal(result.kind, "REFUSED", JSON.stringify(result));
  return result.kind === "REFUSED" ? result.code : "";
}

describe("a beadott adag rögzítése", () => {
  it("az ajánlott adag az ajánláshoz: rendben, figyelmeztetés nélkül", () => {
    assert.deepEqual(checkDoseEntry(entry(), context()), {
      kind: "OK",
      warnings: [],
    });
  });

  it("a jövőbeli időpont tiltott (5 perc óraeltérés belefér), a 24 óránál régebbi is (24 óra még belefér)", () => {
    assert.equal(
      refusedCode({ administeredAt: new Date(NOW.getTime() + 10 * 60000) }),
      "TIME_IN_FUTURE",
    );
    assert.equal(
      checkDoseEntry(
        entry({ administeredAt: new Date(NOW.getTime() + 4 * 60000) }),
        context({ recommendation: recommendation({ createdAt: ago(0.1) }) }),
      ).kind,
      "OK",
    );
    assert.equal(
      refusedCode(
        { administeredAt: ago(24.1), recommendationId: null },
        { recommendation: null },
      ),
      "TIME_TOO_OLD",
    );
    assert.equal(
      checkDoseEntry(
        entry({ administeredAt: ago(24), recommendationId: null }),
        context({ recommendation: null }),
      ).kind,
      "OK",
    );
    assert.equal(
      refusedCode({ administeredAt: new Date(Number.NaN) }),
      "TIME_IN_FUTURE",
    );
  });

  it("a mennyiség és a mértékegység együtt, vagy egyik sem; a nulla és a negatív nem adag", () => {
    assert.equal(refusedCode({ unit: null }), "AMOUNT_UNIT_INCOMPLETE");
    assert.equal(refusedCode({ amount: null }), "AMOUNT_UNIT_INCOMPLETE");
    assert.equal(refusedCode({ amount: 0 }), "AMOUNT_NOT_POSITIVE");
    assert.equal(refusedCode({ amount: -1 }), "AMOUNT_NOT_POSITIVE");
    assert.equal(refusedCode({ amount: Number.NaN }), "AMOUNT_NOT_POSITIVE");
  });

  it("a más termék (ismeretlen hatás) megengedett, ha se mennyiség, se mértékegység nincs, ajánlás nélkül", () => {
    assert.deepEqual(
      checkDoseEntry(
        entry({
          productId: null,
          amount: null,
          unit: null,
          recommendationId: null,
        }),
        context({ recommendation: null, row: null }),
      ),
      { kind: "OK", warnings: [] },
    );
  });

  it("a listán nem szereplő termék azonosítója tiltott", () => {
    assert.equal(
      refusedCode(
        { productId: "p-ismeretlen", recommendationId: null },
        { recommendation: null },
      ),
      "UNKNOWN_PRODUCT",
    );
  });

  it("nem rögzíthető adag az öt paraméteren kívülre", () => {
    assert.equal(
      refusedCode(
        { parameter: "PH", recommendationId: null },
        { recommendation: null },
      ),
      "INVALID_PARAMETER",
    );
  });
});

describe("az ajánláshoz kötött adag", () => {
  it("csak nyitott ajánláshoz; a megválaszolt vagy másnak az ajánlása nem", () => {
    for (const status of ["GIVEN", "PARTIAL", "NOT_GIVEN"] as const)
      assert.equal(
        refusedCode({}, { recommendation: recommendation({ status }) }),
        "RECOMMENDATION_NOT_OPEN",
        status,
      );
    assert.equal(
      refusedCode({}, { recommendation: null }),
      "RECOMMENDATION_NOT_OPEN",
    );
    assert.equal(
      refusedCode({ recommendationId: "rec-masik" }),
      "RECOMMENDATION_NOT_OPEN",
    );
  });

  it("ugyanarra a paraméterre, ugyanarra a termékre, ugyanabban a mértékegységben", () => {
    assert.equal(
      refusedCode(
        {},
        { recommendation: recommendation({ parameterCode: "KALCIUM" }) },
      ),
      "RECOMMENDATION_OTHER_PARAMETER",
    );
    assert.equal(
      refusedCode(
        { productId: "p-masik" },
        { knownProductIds: new Set(["p-kh", "p-masik"]) },
      ),
      "RECOMMENDATION_OTHER_PRODUCT",
    );
    assert.equal(
      refusedCode({ productId: null, amount: null, unit: null }),
      "RECOMMENDATION_OTHER_PRODUCT",
    );
    assert.equal(refusedCode({ unit: "G" }), "RECOMMENDATION_OTHER_UNIT");
  });

  it("az ajánlás kiadása előtti időpont tiltott", () => {
    assert.equal(
      refusedCode(
        { administeredAt: ago(2) },
        { recommendation: recommendation({ createdAt: ago(1) }) },
      ),
      "BEFORE_RECOMMENDATION",
    );
  });

  it("az ajánlottól eltérő mennyiséghez megerősítés kell, megerősítéssel rögzíthető", () => {
    const result = checkDoseEntry(entry({ amount: 0.8 }), context());
    assert.equal(result.kind, "NEEDS_CONFIRMATION");
    assert.ok(result.kind === "NEEDS_CONFIRMATION");
    assert.equal(result.recommendedAmount, 8);
    assert.equal(
      checkDoseEntry(entry({ amount: 0.8, confirmed: true }), context()).kind,
      "OK",
    );
  });
});

describe("a korláton túli adag rögzül, figyelmeztetéssel", () => {
  it("a gyártó napi maximuma fölött (200 liter, 60 ml = 30 / 100 l > 20)", () => {
    const result = checkDoseEntry(
      entry({ amount: 60, confirmed: true }),
      context(),
    );
    assert.ok(result.kind === "OK");
    assert.deepEqual(
      result.warnings.map((warning) => warning.code),
      ["ABOVE_MAKER_MAX", "ABOVE_DAILY_LIMIT"],
    );
  });

  it("csak a napi korlát fölött (12 ml = 6 / 100 l, 1,5 dKH > 1)", () => {
    const result = checkDoseEntry(
      entry({ amount: 12, confirmed: true }),
      context(),
    );
    assert.ok(result.kind === "OK");
    assert.deepEqual(
      result.warnings.map((warning) => warning.code),
      ["ABOVE_DAILY_LIMIT"],
    );
  });

  it("sor vagy térfogat nélkül nincs mihez mérni: nincs figyelmeztetés", () => {
    for (const over of [{ row: null }, { volumeLiters: null }]) {
      const result = checkDoseEntry(
        entry({ amount: 60, confirmed: true }),
        context(over),
      );
      assert.ok(result.kind === "OK");
      assert.deepEqual(result.warnings, []);
    }
  });
});
