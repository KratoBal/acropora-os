import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { RECOMMENDATION_FRAME_VERSION, DAILY_LIMITS } from "./frame.js";
import { huNumber } from "./templates.js";
import { recommend } from "./recommend.js";
import type {
  AdministrationRecord,
  DoseRow,
  MeasurementPoint,
  PriorRecommendation,
  RecommendationInput,
  RecommendationOptions,
} from "./types.js";

/**
 * THE AUTOMATIC RECOMMENDATION, ONE GATE AT A TIME. Made-up data. The numbers
 * are worked by hand in the comments, not by running the function.
 *
 * The base case: 200 litres (so 2 hundred-litre units), KH band 7 to 9 (the
 * target is 8), a KH of 6,0 measured an hour ago. One ml of "Minta KH+" raises
 * KH by 0,25 in 100 litres. Needed 8 - 6 = 2; the daily limit allows 1; so
 * 1 x 2 / 0,25 = 8 ml, which is 4 ml per 100 litres, under the maker's 20.
 */
const NOW = new Date("2026-10-21T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const ago = (hours: number) => new Date(NOW.getTime() - hours * HOUR);

function point(
  parameter: string,
  value: number,
  over: Partial<MeasurementPoint> = {},
): MeasurementPoint {
  return {
    id: `m-${parameter.toLowerCase()}`,
    occasionId: "o1",
    parameter,
    value,
    measuredAt: ago(1),
    source: "MANUAL",
    alert: false,
    ...over,
  };
}

function row(over: Partial<DoseRow> = {}): DoseRow {
  return {
    rowId: "r-kh",
    rowVersion: 3,
    productId: "p-kh",
    productName: "Minta KH+",
    parameter: "KH",
    direction: "EMEL",
    effectPer100L: 0.25,
    unit: "ML",
    step: 1,
    maxDailyDosePer100L: 20,
    effectHours: 12,
    source: "Gyártói címke (teszt)",
    refusals: [],
    ...over,
  };
}

function input(over: Partial<RecommendationInput> = {}): RecommendationInput {
  return {
    now: NOW,
    parameter: "KH",
    volumeLiters: 200,
    bands: { KH: { min: 7, max: 9 } },
    measurements: [point("KH", 6)],
    rows: [row()],
    administrations: [],
    priorRecommendations: [],
    doseListBuiltAt: ago(1),
    ...over,
  };
}

function prior(over: Partial<PriorRecommendation> = {}): PriorRecommendation {
  return {
    id: "rec-1",
    createdAt: ago(20),
    parameter: "KH",
    basisMeasurementId: "m-old",
    productId: "p-kh",
    amount: 8,
    unit: "ML",
    status: "EXPIRED",
    effectEndsAt: ago(8),
    changes: [{ parameter: "KH", change: 1 }],
    ...over,
  };
}

function given(over: Partial<AdministrationRecord> = {}): AdministrationRecord {
  return {
    id: "a-1",
    at: ago(23),
    parameter: "KH",
    productId: "p-kh",
    amount: 4,
    unit: "ML",
    ...over,
  };
}

function reasonOf(
  over: Partial<RecommendationInput>,
  options?: RecommendationOptions,
): string {
  const result = recommend(input(over), options);
  assert.equal(result.kind, "NO_DOSE", JSON.stringify(result));
  return result.kind === "NO_DOSE" ? result.reason : "";
}

function doseOf(
  over: Partial<RecommendationInput>,
  options?: RecommendationOptions,
) {
  const result = recommend(input(over), options);
  assert.equal(result.kind, "DOSE", JSON.stringify(result));
  assert.ok(result.kind === "DOSE");
  return result;
}

describe("the calculation", () => {
  it("gives the hand-worked dose: cut by the daily limit, rounded down to the step, in the fixed sentence", () => {
    const result = doseOf({});
    assert.equal(result.amount, 8);
    assert.equal(result.unit, "ML");
    assert.equal(result.durationDays, 1);
    assert.equal(result.product.productName, "Minta KH+");
    assert.equal(
      result.text,
      "A KH alacsony; javasolt adag: 8 ml Minta KH+ naponta, 1 napon át. Forrás: Gyártói címke (teszt). Mérj újra 12 óra elteltével, mielőtt újra adagolsz.",
    );
    assert.equal(result.basisMeasurementId, "m-kh");
  });

  it("logs the frame version, the row and its version, the basis and what it reserves", () => {
    const { log } = doseOf({});
    assert.equal(log.frameVersion, RECOMMENDATION_FRAME_VERSION);
    assert.equal(log.outcome, "DOSE");
    assert.equal(log.rowId, "r-kh");
    assert.equal(log.rowVersion, 3);
    assert.equal(log.basisMeasurementId, "m-kh");
    // 8 ml / 2 units x 0,25 = +1,0 dKH
    assert.deepEqual(log.reservedChanges, [{ parameter: "KH", change: 1 }]);
  });

  it("uses the whole needed change when it is under the daily limit", () => {
    // magnesium band 1250-1350, target 1300, value 1240: needed 60 (limit 100); 10 mg/l per ml per 100 l
    // 60 x 2 / 10 = 12 ml
    const result = doseOf({
      parameter: "MAGNEZIUM",
      bands: { MAGNEZIUM: { min: 1250, max: 1350 } },
      measurements: [point("MAGNEZIUM", 1240)],
      rows: [
        row({
          rowId: "r-mg",
          productId: "p-mg",
          productName: "Minta Mg",
          parameter: "MAGNEZIUM",
          effectPer100L: 10,
        }),
      ],
    });
    assert.equal(result.amount, 12);
    assert.match(result.text, /^A magnézium alacsony; javasolt adag: 12 ml/);
  });

  it("rounds DOWN to the dose step, never up", () => {
    // 8 ml worked out, step 5 -> 5 ml
    assert.equal(doseOf({ rows: [row({ step: 5 })] }).amount, 5);
  });

  it("writes the decimal comma in the amount", () => {
    // step 0,5 and effect 0,3: 1 x 2 / 0,3 = 6,67 -> 6,5
    const result = doseOf({ rows: [row({ step: 0.5, effectPer100L: 0.3 })] });
    assert.equal(result.amount, 6.5);
    assert.match(result.text, /javasolt adag: 6,5 ml/);
  });
});

describe("the refusals, in the order a customer fixes them", () => {
  it("OUT_OF_CIRCLE: a parameter outside the circle, and a direction without a limit", () => {
    assert.equal(reasonOf({ parameter: "PH" }), "OUT_OF_CIRCLE");
    // KH 10 is above the band: reducing KH is not in the circle
    assert.equal(
      reasonOf({ measurements: [point("KH", 10)] }),
      "OUT_OF_CIRCLE",
    );
  });

  it("ACTIVE_RECOMMENDATION: one valid proposal per parameter, and it is named", () => {
    const result = recommend(
      input({
        priorRecommendations: [
          prior({
            id: "rec-open",
            status: "OPEN",
            createdAt: ago(1),
            effectEndsAt: new Date(NOW.getTime() + 11 * HOUR),
          }),
        ],
      }),
    );
    assert.equal(result.kind, "NO_DOSE");
    assert.ok(result.kind === "NO_DOSE");
    assert.equal(result.reason, "ACTIVE_RECOMMENDATION");
    assert.equal(result.activeRecommendationId, "rec-open");
  });

  it("NO_VOLUME: missing, zero or not a number", () => {
    for (const volumeLiters of [null, 0, Number.NaN, -5])
      assert.equal(reasonOf({ volumeLiters }), "NO_VOLUME");
  });

  it("NO_TARGET_BAND: no band, a one-sided band, an upside-down band", () => {
    assert.equal(reasonOf({ bands: {} }), "NO_TARGET_BAND");
    assert.equal(reasonOf({ bands: { KH: { min: 7 } } }), "NO_TARGET_BAND");
    assert.equal(
      reasonOf({ bands: { KH: { min: 9, max: 7 } } }),
      "NO_TARGET_BAND",
    );
  });

  it("NO_MEASUREMENT: nothing measured for the parameter", () => {
    assert.equal(reasonOf({ measurements: [] }), "NO_MEASUREMENT");
    assert.equal(
      reasonOf({ measurements: [point("KALCIUM", 400)] }),
      "NO_MEASUREMENT",
    );
  });

  it("MEASUREMENT_IN_FUTURE: a typed-in future date cannot pass for a fresh measurement", () => {
    assert.equal(
      reasonOf({
        measurements: [
          point("KH", 6, { measuredAt: new Date(NOW.getTime() + 10 * 60000) }),
        ],
      }),
      "MEASUREMENT_IN_FUTURE",
    );
    // a few minutes of clock difference is not a typo
    doseOf({
      measurements: [
        point("KH", 6, { measuredAt: new Date(NOW.getTime() + 4 * 60000) }),
      ],
    });
  });

  it("MEASUREMENT_TOO_OLD: KH after 3 days, magnesium after 7", () => {
    assert.equal(
      reasonOf({
        measurements: [
          point("KH", 6, { measuredAt: new Date(NOW.getTime() - 73 * HOUR) }),
        ],
      }),
      "MEASUREMENT_TOO_OLD",
    );
    const fresh = recommend(
      input({
        measurements: [
          point("KH", 6, { measuredAt: new Date(NOW.getTime() - 71 * HOUR) }),
        ],
      }),
    );
    assert.equal(fresh.kind, "DOSE");
    const result = recommend(
      input({
        measurements: [
          point("KH", 6, { measuredAt: new Date(NOW.getTime() - 73 * HOUR) }),
        ],
      }),
    );
    assert.ok(result.kind === "NO_DOSE");
    assert.match(result.text, /régebbi 3 napnál/);
    assert.equal(
      reasonOf({
        parameter: "MAGNEZIUM",
        bands: { MAGNEZIUM: { min: 1250, max: 1350 } },
        measurements: [
          point("MAGNEZIUM", 1240, {
            measuredAt: new Date(NOW.getTime() - 169 * HOUR),
          }),
        ],
      }),
      "MEASUREMENT_TOO_OLD",
    );
  });

  it("IN_RANGE: inside the band there is no dose, even below the target", () => {
    assert.equal(reasonOf({ measurements: [point("KH", 7.5)] }), "IN_RANGE");
    assert.equal(reasonOf({ measurements: [point("KH", 7)] }), "IN_RANGE");
  });

  it("uses the NEWEST measurement of the parameter, not the lowest or the first", () => {
    // newest 8 (in the band) over an older 6: nothing to do
    assert.equal(
      reasonOf({
        measurements: [
          point("KH", 8, { id: "m-new", measuredAt: ago(1) }),
          point("KH", 6, { id: "m-old", measuredAt: ago(30) }),
        ],
      }),
      "IN_RANGE",
    );
    // newest 6 over an older 8: a dose, on the newest
    assert.equal(
      doseOf({
        measurements: [
          point("KH", 8, { id: "m-old", measuredAt: ago(30) }),
          point("KH", 6, { id: "m-new", measuredAt: ago(1) }),
        ],
      }).basisMeasurementId,
      "m-new",
    );
  });
});

describe("after a dose, and the same measurement", () => {
  it("REMEASURE_AFTER_DOSE: a measurement older than the last dose's effect time", () => {
    // given 23 h ago, 12 h effect -> ends 11 h ago; a measurement 12 h ago predates the end
    assert.equal(
      reasonOf({
        measurements: [point("KH", 6, { measuredAt: ago(12) })],
        administrations: [given()],
      }),
      "REMEASURE_AFTER_DOSE",
    );
    // measured after the effect ended: the dose is allowed (and its 0,5 counts in the limit)
    assert.ok(
      doseOf({
        measurements: [point("KH", 6, { measuredAt: ago(1) })],
        administrations: [given()],
      }),
    );
  });

  it("REMEASURE_AFTER_DOSE: a dose of an unlisted product keeps the default 24 hour effect time", () => {
    assert.equal(
      reasonOf({
        administrations: [given({ productId: null, at: ago(10) })],
      }),
      "REMEASURE_AFTER_DOSE",
    );
  });

  it("REMEASURE_AFTER_DOSE: a recommendation counted as given (expired, given, partial) blocks until a newer measurement; a not-given one does not", () => {
    for (const status of ["EXPIRED", "GIVEN", "PARTIAL"] as const)
      assert.equal(
        reasonOf({
          priorRecommendations: [
            prior({ status, createdAt: ago(3), effectEndsAt: ago(0.5) }),
          ],
        }),
        "REMEASURE_AFTER_DOSE",
        status,
      );
    assert.ok(
      doseOf({
        priorRecommendations: [
          prior({
            status: "NOT_GIVEN",
            createdAt: ago(3),
            effectEndsAt: ago(0.5),
          }),
        ],
      }),
    );
  });

  it("SAME_MEASUREMENT_USED: a day later the same measurement opens no new correction; within the day it does", () => {
    assert.equal(
      reasonOf({
        priorRecommendations: [
          prior({
            status: "NOT_GIVEN",
            basisMeasurementId: "m-kh",
            createdAt: ago(25),
          }),
        ],
      }),
      "SAME_MEASUREMENT_USED",
    );
    assert.ok(
      doseOf({
        priorRecommendations: [
          prior({
            status: "NOT_GIVEN",
            basisMeasurementId: "m-kh",
            createdAt: ago(2),
          }),
        ],
      }),
    );
  });
});

describe("gate 2: an alarm-level manual measurement needs a repeat", () => {
  // KH 4,0: the distance 3 is at least the band's width 2, so it is an alarm; needed 8 - 4 = 4, exactly twice the width
  const alarm = (over: Partial<MeasurementPoint> = {}) =>
    point("KH", 4, { alert: true, ...over });

  it("NEEDS_REPEAT_MEASUREMENT: one manual alarm", () => {
    assert.equal(
      reasonOf({ measurements: [alarm()] }),
      "NEEDS_REPEAT_MEASUREMENT",
    );
  });

  it("a repeat alarm within 48 hours, or a shop measurement, lets the dose through (cut to the daily limit)", () => {
    const repeated = doseOf({
      measurements: [
        alarm(),
        point("KH", 4.1, { id: "m-before", alert: true, measuredAt: ago(11) }),
      ],
    });
    // 1 x 2 / 0,25 = 8 ml again: the limit, not the deviation, sets the dose
    assert.equal(repeated.amount, 8);
    assert.equal(
      doseOf({ measurements: [alarm({ source: "SHOP" })] }).amount,
      8,
    );
  });

  it("a repeat older than 48 hours, or one that is not an alarm, does not count", () => {
    assert.equal(
      reasonOf({
        measurements: [
          alarm(),
          point("KH", 4.1, {
            id: "m-before",
            alert: true,
            measuredAt: ago(60),
          }),
        ],
      }),
      "NEEDS_REPEAT_MEASUREMENT",
    );
    assert.equal(
      reasonOf({
        measurements: [
          alarm(),
          point("KH", 7, { id: "m-before", alert: false, measuredAt: ago(11) }),
        ],
      }),
      "NEEDS_REPEAT_MEASUREMENT",
    );
  });
});

describe("gate 5: the deviation", () => {
  it("DEVIATION_TOO_LARGE: more than twice the band's width from the target", () => {
    // 3,9: needed 4,1 > 2 x 2
    assert.equal(
      reasonOf({
        measurements: [point("KH", 3.9, { alert: true, source: "SHOP" })],
      }),
      "DEVIATION_TOO_LARGE",
    );
  });
});

describe("6.7: nitrate and phosphate", () => {
  // nitrate band 0-10, target 5, value 14 (needed 9); phosphate band 0,02-0,1
  const nitrate = {
    parameter: "NITRAT",
    bands: {
      NITRAT: { min: 0, max: 10 },
      FOSZFAT: { min: 0.02, max: 0.1 },
    },
    rows: [
      row({
        rowId: "r-no3",
        productId: "p-no3",
        productName: "Minta NO3-",
        parameter: "NITRAT",
        direction: "CSOKKENT",
        effectPer100L: 2,
      }),
    ],
  } satisfies Partial<RecommendationInput>;
  /** The frame's nitrate-reduction limit turned back into a placeholder, as it was in v0. */
  const placeholderLimits = DAILY_LIMITS.map((limit) =>
    limit.parameter === "NITRAT" && limit.direction === "CSOKKENT"
      ? { ...limit, approval: "HELYORZO" as const, approvedBy: null }
      : limit,
  );

  it("reduces nitrate when phosphate is measured at the same visit and inside its band", () => {
    // approved limit 5 -> 5 x 2 / 2 = 5 ml; -5 mg/l reserved
    const result = doseOf({
      ...nitrate,
      measurements: [point("NITRAT", 14), point("FOSZFAT", 0.05)],
    });
    assert.equal(result.amount, 5);
    assert.deepEqual(result.log.reservedChanges, [
      { parameter: "NITRAT", change: -5 },
    ]);
    assert.match(result.text, /^A nitrát magas; javasolt adag: 5 ml/);
  });

  it("NITRATE_PHOSPHATE_GUARD: the other not measured, measured at another visit, too old, undetectable, or below its band", () => {
    const cases: [string, MeasurementPoint[]][] = [
      ["not measured", [point("NITRAT", 14)]],
      [
        "another visit",
        [point("NITRAT", 14), point("FOSZFAT", 0.05, { occasionId: "o2" })],
      ],
      [
        "too old",
        [
          point("NITRAT", 14),
          point("FOSZFAT", 0.05, { measuredAt: ago(8 * 24) }),
        ],
      ],
      ["zero, band 0,02-0,1", [point("NITRAT", 14), point("FOSZFAT", 0)]],
      ["below its band", [point("NITRAT", 14), point("FOSZFAT", 0.01)]],
    ];
    for (const [name, measurements] of cases)
      assert.equal(
        reasonOf({ ...nitrate, measurements }),
        "NITRATE_PHOSPHATE_GUARD",
        name,
      );
  });

  it("NITRATE_PHOSPHATE_GUARD: a phosphate of exactly 0 is undetectable even where the band starts at 0", () => {
    assert.equal(
      reasonOf({
        ...nitrate,
        bands: { NITRAT: { min: 0, max: 10 }, FOSZFAT: { min: 0, max: 0.1 } },
        measurements: [point("NITRAT", 14), point("FOSZFAT", 0)],
      }),
      "NITRATE_PHOSPHATE_GUARD",
    );
  });

  it("LIMIT_NOT_APPROVED: a limit that is only a placeholder gives no dose unless a test allows it", () => {
    const over = {
      ...nitrate,
      measurements: [point("NITRAT", 14), point("FOSZFAT", 0.05)],
    };
    assert.equal(
      reasonOf(over, { limits: placeholderLimits }),
      "LIMIT_NOT_APPROVED",
    );
    assert.equal(
      doseOf(over, { limits: placeholderLimits, allowPlaceholderLimits: true })
        .amount,
      5,
    );
  });

  it("every limit in the frame is approved, with who approved it and when (Balázs, 2026-10-15 and 2026-10-20)", () => {
    assert.deepEqual(
      DAILY_LIMITS.map(
        (limit) =>
          `${limit.parameter}:${limit.direction}:${limit.maxChangePer24h}:${limit.approval}`,
      ),
      [
        "KH:EMEL:1:JOVAHAGYVA",
        "KALCIUM:EMEL:20:JOVAHAGYVA",
        "MAGNEZIUM:EMEL:100:JOVAHAGYVA",
        "NITRAT:CSOKKENT:5:JOVAHAGYVA",
        "NITRAT:EMEL:2:JOVAHAGYVA",
        "FOSZFAT:CSOKKENT:0.03:JOVAHAGYVA",
        "FOSZFAT:EMEL:0.02:JOVAHAGYVA",
      ],
    );
    for (const limit of DAILY_LIMITS)
      assert.match(limit.approvedBy ?? "", /^Balázs 2026-10-(15|20) /);
  });
});

describe("6.5: the rolling 24 hours", () => {
  it("DAILY_LIMIT_FILLED: an earlier recommendation counts as given", () => {
    assert.equal(
      reasonOf({
        priorRecommendations: [
          prior({ changes: [{ parameter: "KH", change: 1 }] }),
        ],
      }),
      "DAILY_LIMIT_FILLED",
    );
  });

  it("only what is left of the limit is given (the earlier reserved 0,4 -> 0,6 left -> 0,6 x 2 / 0,25 = 4,8 -> 4 ml)", () => {
    assert.equal(
      doseOf({
        priorRecommendations: [
          prior({ changes: [{ parameter: "KH", change: 0.4 }] }),
        ],
      }).amount,
      4,
    );
  });

  it("an earlier recommendation older than 24 hours no longer counts", () => {
    assert.equal(
      doseOf({
        priorRecommendations: [
          prior({
            createdAt: ago(25),
            effectEndsAt: ago(13),
            changes: [{ parameter: "KH", change: 1 }],
          }),
        ],
      }).amount,
      8,
    );
  });

  it("a recorded dose counts by its effect: 4 ml / 2 units x 0,25 = 0,5 -> 0,5 left -> 4 ml; one older than 24 hours does not", () => {
    assert.equal(
      doseOf({ administrations: [given({ at: ago(23) })] }).amount,
      4,
    );
    assert.equal(
      doseOf({
        administrations: [given({ at: ago(25) })],
      }).amount,
      8,
    );
  });

  it("a recorded dose of the other direction does not offset the limit", () => {
    assert.equal(
      doseOf({
        rows: [
          row(),
          row({ rowId: "r-down", productId: "p-down", direction: "CSOKKENT" }),
        ],
        administrations: [
          given({ productId: "p-down", amount: 100, at: ago(23) }),
        ],
      }).amount,
      8,
    );
  });

  it("UNKNOWN_EFFECT_DOSE: a recorded dose with no amount (or another unit) on this parameter", () => {
    assert.equal(
      reasonOf({ administrations: [given({ amount: null })] }),
      "UNKNOWN_EFFECT_DOSE",
    );
    assert.equal(
      reasonOf({ administrations: [given({ unit: "G" })] }),
      "UNKNOWN_EFFECT_DOSE",
    );
  });
});

describe("the products", () => {
  it("NO_USABLE_PRODUCT: no rows, or only rows with a refusal", () => {
    assert.equal(reasonOf({ rows: [] }), "NO_USABLE_PRODUCT");
    assert.equal(
      reasonOf({ rows: [row({ refusals: ["NOT_VERIFIED"] })] }),
      "NO_USABLE_PRODUCT",
    );
    assert.equal(
      reasonOf({ rows: [row({ parameter: "KALCIUM" })] }),
      "NO_USABLE_PRODUCT",
    );
  });

  it("DOSE_ABOVE_MANUFACTURER_MAX: over the maker's daily maximum, and a 100-times-too-small effect (a typo) cannot slip through", () => {
    // 8 ml = 4 ml per 100 l; maximum 3
    assert.equal(
      reasonOf({ rows: [row({ maxDailyDosePer100L: 3 })] }),
      "DOSE_ABOVE_MANUFACTURER_MAX",
    );
    // effect 0,0025 instead of 0,25: 1 x 2 / 0,0025 = 800 ml = 400 per 100 l, maximum 20
    assert.equal(
      reasonOf({ rows: [row({ effectPer100L: 0.0025 })] }),
      "DOSE_ABOVE_MANUFACTURER_MAX",
    );
  });

  it("the maker's maximum counts what the same product already gave in 24 hours", () => {
    // Magnesium, band 1250-1350 (target 1300), value 1240: needed 60, under the limit 100, so the limit does not bind.
    // 10 mg/l per ml per 100 l: 60 x 2 / 10 = 12 ml = 6 per 100 l. Maximum 8 per 100 l.
    const magnesium = {
      parameter: "MAGNEZIUM",
      bands: { MAGNEZIUM: { min: 1250, max: 1350 } },
      measurements: [point("MAGNEZIUM", 1240)],
      rows: [
        row({
          rowId: "r-mg",
          productId: "p-mg",
          productName: "Minta Mg",
          parameter: "MAGNEZIUM",
          effectPer100L: 10,
          maxDailyDosePer100L: 8,
        }),
      ],
    } satisfies Partial<RecommendationInput>;
    // alone: 6 <= 8, a dose
    assert.equal(doseOf(magnesium).amount, 12);
    // 8 ml (4 per 100 l, 40 mg/l) given 23 hours ago: 60 left under the limit -> 12 ml = 6 per 100 l again,
    // but 4 + 6 = 10 > 8 -> refused
    assert.equal(
      reasonOf({
        ...magnesium,
        administrations: [
          given({
            parameter: "MAGNEZIUM",
            productId: "p-mg",
            amount: 8,
            at: ago(23),
          }),
        ],
      }),
      "DOSE_ABOVE_MANUFACTURER_MAX",
    );
  });

  it("DOSE_BELOW_STEP: the dose is smaller than the smallest step", () => {
    assert.equal(reasonOf({ rows: [row({ step: 10 })] }), "DOSE_BELOW_STEP");
  });

  it("INCOMPLETE_DOSE_TEMPLATE: a row without a source never gives the dose sentence", () => {
    assert.equal(
      reasonOf({ rows: [row({ source: "   " })] }),
      "INCOMPLETE_DOSE_TEMPLATE",
    );
  });

  it("the no-dose sentences are fixed and carry no dose", () => {
    const result = recommend(input({ rows: [] }));
    assert.ok(result.kind === "NO_DOSE");
    assert.equal(
      result.text,
      "Ehhez a paraméterhez (KH) most nincs ellenőrzött termék-adag; kérdezd a boltot.",
    );
    assert.doesNotMatch(result.text, /\d/);
    assert.equal(result.log.outcome, "NO_DOSE");
    assert.deepEqual(result.log.reservedChanges, []);
  });
});

const placeholderLimitsForSide = DAILY_LIMITS.map((limit) =>
  limit.parameter === "NITRAT" && limit.direction === "CSOKKENT"
    ? { ...limit, approval: "HELYORZO" as const, approvedBy: null }
    : limit,
);

describe("a product that moves more than one parameter (gate 6)", () => {
  // "Minta KH+Ca": per ml per 100 l, KH +0,25 and calcium +5
  const combo = (calciumEffect = 5) => [
    row({
      rowId: "r-combo-kh",
      productId: "p-combo",
      productName: "Minta KH+Ca",
    }),
    row({
      rowId: "r-combo-ca",
      productId: "p-combo",
      productName: "Minta KH+Ca",
      parameter: "KALCIUM",
      effectPer100L: calciumEffect,
    }),
  ];
  const bands = { KH: { min: 7, max: 9 }, KALCIUM: { min: 380, max: 450 } };

  it("counts the effect on every parameter and says to give KH and calcium apart", () => {
    // calcium 400: headroom 50, limit 20 -> 20 x 2 / 5 = 8 ml; KH 8 ml -> same. Both +: KH +1, Ca +20
    const result = doseOf({
      bands,
      rows: combo(),
      measurements: [point("KH", 6), point("KALCIUM", 400)],
    });
    assert.equal(result.amount, 8);
    assert.deepEqual(result.log.reservedChanges, [
      { parameter: "KH", change: 1 },
      { parameter: "KALCIUM", change: 20 },
    ]);
    assert.match(result.text, /külön időpontban és külön helyen/);
  });

  it("is cut by the room the other parameter has inside its band", () => {
    // calcium 445: headroom 5 -> 5 x 2 / 5 = 2 ml
    assert.equal(
      doseOf({
        bands,
        rows: combo(),
        measurements: [point("KH", 6), point("KALCIUM", 445)],
      }).amount,
      2,
    );
  });

  it("is cut by the other parameter's own daily limit, spent by an earlier dose", () => {
    // calcium +15 reserved earlier today -> 5 left -> 5 x 2 / 5 = 2 ml
    assert.equal(
      doseOf({
        bands,
        rows: combo(),
        measurements: [point("KH", 6), point("KALCIUM", 400)],
        priorRecommendations: [
          prior({
            parameter: "KALCIUM",
            changes: [{ parameter: "KALCIUM", change: 15 }],
            effectEndsAt: ago(8),
          }),
        ],
      }).amount,
      2,
    );
  });

  it("drops out when the other parameter is already above its band, unmeasured, or measured too long ago", () => {
    for (const calcium of [
      point("KALCIUM", 460),
      null,
      point("KALCIUM", 400, { measuredAt: ago(4 * 24) }),
    ])
      assert.equal(
        reasonOf({
          bands,
          rows: combo(),
          measurements: calcium ? [point("KH", 6), calcium] : [point("KH", 6)],
        }),
        "NO_USABLE_PRODUCT",
      );
  });

  it("drops out when the other parameter's limit is not approved", () => {
    // a product that also LOWERS nitrate, while the nitrate-reduction limit is only a placeholder
    assert.equal(
      reasonOf(
        {
          bands: { ...bands, NITRAT: { min: 0, max: 10 } },
          rows: [
            row({ productId: "p-x", productName: "Minta X" }),
            row({
              rowId: "r-x-no3",
              productId: "p-x",
              productName: "Minta X",
              parameter: "NITRAT",
              direction: "CSOKKENT",
              effectPer100L: 1,
            }),
          ],
          measurements: [point("KH", 6), point("NITRAT", 8)],
        },
        { limits: placeholderLimitsForSide },
      ),
      "NO_USABLE_PRODUCT",
    );
  });

  it("prefers the product that moves the fewest other parameters, even with a later id; equal ones by the lowest id", () => {
    const pure = row({
      rowId: "r-pure",
      productId: "p-z-pure",
      productName: "Minta tiszta KH",
    });
    const both = doseOf({
      bands,
      rows: [...combo(), pure],
      measurements: [point("KH", 6), point("KALCIUM", 400)],
    });
    assert.equal(both.product.productId, "p-z-pure");

    const a = row({ rowId: "r-a", productId: "p-a", productName: "A" });
    const b = row({ rowId: "r-b", productId: "p-b", productName: "B" });
    assert.equal(doseOf({ rows: [b, a] }).product.productId, "p-a");
  });
});

describe("a dose whose effect cannot be counted is a refusal, never an omission (review of #1751)", () => {
  const bands = { KH: { min: 7, max: 9 }, KALCIUM: { min: 380, max: 450 } };
  const combo = [
    row({
      rowId: "r-combo-kh",
      productId: "p-combo",
      productName: "Minta KH+Ca",
      effectHours: 2,
    }),
    row({
      rowId: "r-combo-ca",
      productId: "p-combo",
      productName: "Minta KH+Ca",
      parameter: "KALCIUM",
      effectPer100L: 5,
      effectHours: 2,
    }),
  ];

  it("UNKNOWN_EFFECT_DOSE: a dose of a two-component product recorded for the OTHER parameter in another unit also moved this one", () => {
    // 10 g recorded for calcium 3 hours ago; the product's rows are in ml. The KH row's effect time (2 h) is over and KH
    // was measured after it, so only the unknown effect on KH can stop the request.
    const over = {
      bands,
      rows: combo,
      measurements: [point("KH", 6), point("KALCIUM", 400)],
      administrations: [
        given({
          parameter: "KALCIUM",
          productId: "p-combo",
          amount: 10,
          unit: "G" as const,
          at: ago(3),
        }),
      ],
    };
    assert.equal(reasonOf(over), "UNKNOWN_EFFECT_DOSE");
    // control: the same dose in the rows' unit is counted, and the request goes through
    const counted = recommend(
      input({
        ...over,
        administrations: [
          given({
            parameter: "KALCIUM",
            productId: "p-combo",
            amount: 2,
            unit: "ML",
            at: ago(3),
          }),
        ],
      }),
    );
    assert.equal(counted.kind, "DOSE");
  });

  it("a product whose row for this parameter was refused since still moved it: the dose is not left out (the default 24 hour effect time applies)", () => {
    const refusedKh = row({
      rowId: "r-old-kh",
      productId: "p-old",
      productName: "Minta régi",
      refusals: ["NOT_VERIFIED"],
    });
    const liveCa = row({
      rowId: "r-old-ca",
      productId: "p-old",
      productName: "Minta régi",
      parameter: "KALCIUM",
      effectPer100L: 5,
    });
    assert.equal(
      reasonOf({
        bands,
        rows: [row(), refusedKh, liveCa],
        measurements: [point("KH", 6), point("KALCIUM", 400)],
        administrations: [
          given({
            parameter: "KALCIUM",
            productId: "p-old",
            amount: 4,
            unit: "ML",
            at: ago(3),
          }),
        ],
      }),
      "REMEASURE_AFTER_DOSE",
    );
  });

  it("a side parameter with a dose of unknown effect drops the product out (the pure one is taken)", () => {
    const mystery = given({
      parameter: "KALCIUM",
      productId: null,
      amount: 5,
      unit: "ML",
      at: ago(30),
    });
    // 30 hours ago is outside the window: a control that it does not block
    assert.equal(
      doseOf({
        bands,
        rows: combo,
        measurements: [point("KH", 6), point("KALCIUM", 400)],
        administrations: [mystery],
      }).product.productId,
      "p-combo",
    );
    const recent = { ...mystery, at: ago(5) };
    assert.equal(
      reasonOf({
        bands,
        rows: combo,
        measurements: [point("KH", 6), point("KALCIUM", 400)],
        administrations: [recent],
      }),
      "NO_USABLE_PRODUCT",
    );
    const pure = row({
      rowId: "r-pure",
      productId: "p-z-pure",
      productName: "Tiszta",
    });
    assert.equal(
      doseOf({
        bands,
        rows: [...combo, pure],
        measurements: [point("KH", 6), point("KALCIUM", 400)],
        administrations: [recent],
      }).product.productId,
      "p-z-pure",
    );
  });

  it("a side parameter whose last dose has an uncountable effect (another unit) drops the product out even after its effect time", () => {
    // a calcium-only product (rows in ml) recorded in grams 3 h ago; its effect time (2 h) is over and calcium was
    // measured after it, so ONLY the unknown effect can stop the combined product for the KH request
    const caOnly = row({
      rowId: "r-ca-only",
      productId: "p-ca-only",
      productName: "Minta csak Ca",
      parameter: "KALCIUM",
      effectPer100L: 5,
      effectHours: 2,
    });
    const over = {
      bands,
      rows: [...combo, caOnly],
      measurements: [
        point("KH", 6),
        point("KALCIUM", 400, { measuredAt: ago(0.5) }),
      ],
    };
    assert.equal(
      reasonOf({
        ...over,
        administrations: [
          given({
            parameter: "KALCIUM",
            productId: "p-ca-only",
            amount: 10,
            unit: "G",
            at: ago(3),
          }),
        ],
      }),
      "NO_USABLE_PRODUCT",
    );
    // control: the same dose in ml is counted, and the combined product is usable
    assert.equal(
      doseOf({
        ...over,
        administrations: [
          given({
            parameter: "KALCIUM",
            productId: "p-ca-only",
            amount: 2,
            unit: "ML",
            at: ago(3),
          }),
        ],
      }).product.productId,
      "p-combo",
    );
  });

  it("a side parameter measured BEFORE the last dose that moved it drops the product out", () => {
    // calcium 440 measured 10 h ago; 6 ml of a calcium product (+15 mg/l) recorded 8 h ago with a 6 h effect time:
    // the real calcium is about 455, outside the band, and the 440 says nothing about it
    const caProduct = row({
      rowId: "r-ca",
      productId: "p-ca",
      productName: "Minta Ca",
      parameter: "KALCIUM",
      effectPer100L: 5,
      effectHours: 6,
    });
    const over = {
      bands: { KH: { min: 7, max: 9 }, KALCIUM: { min: 400, max: 450 } },
      rows: [...combo, caProduct],
      administrations: [
        given({
          parameter: "KALCIUM",
          productId: "p-ca",
          amount: 6,
          unit: "ML",
          at: ago(8),
        }),
      ],
    };
    assert.equal(
      reasonOf({
        ...over,
        measurements: [
          point("KH", 6),
          point("KALCIUM", 440, { measuredAt: ago(10) }),
        ],
      }),
      "NO_USABLE_PRODUCT",
    );
    // measured after the effect ended (2 hours ago): 440 is today's value, and 15 mg/l is already used of the limit
    assert.equal(
      doseOf({
        ...over,
        measurements: [
          point("KH", 6),
          point("KALCIUM", 440, { measuredAt: ago(1) }),
        ],
      }).product.productId,
      "p-combo",
    );
  });
});

describe("the maker's maximum counts open and expired recommendations (review of #1751)", () => {
  // magnesium: needed 60 (limit 100 does not bind), 10 mg/l per ml per 100 l, so 12 ml = 6 per 100 l; maximum 8
  const magnesium = (priorOver: Partial<PriorRecommendation>) => ({
    parameter: "MAGNEZIUM",
    bands: { MAGNEZIUM: { min: 1250, max: 1350 } },
    measurements: [point("MAGNEZIUM", 1240)],
    rows: [
      row({
        rowId: "r-mg",
        productId: "p-mg",
        productName: "Minta Mg",
        parameter: "MAGNEZIUM",
        effectPer100L: 10,
        maxDailyDosePer100L: 8,
      }),
    ],
    priorRecommendations: [
      prior({
        parameter: "MAGNEZIUM",
        productId: "p-mg",
        amount: 8,
        unit: "ML",
        changes: [{ parameter: "MAGNEZIUM", change: 40 }],
        ...priorOver,
      }),
    ],
  });

  it("an expired recommendation of the product (8 ml = 4 per 100 l) plus 6 per 100 l is over 8", () => {
    assert.equal(
      reasonOf(magnesium({ status: "EXPIRED" })),
      "DOSE_ABOVE_MANUFACTURER_MAX",
    );
    // a recommendation the customer said was not given does not count
    assert.equal(doseOf(magnesium({ status: "NOT_GIVEN" })).amount, 12);
  });

  it("a recommendation of another product, or older than 24 hours, does not count against this product's maximum", () => {
    assert.equal(
      doseOf(magnesium({ productId: "p-other", changes: [] })).amount,
      12,
    );
    assert.equal(
      doseOf(
        magnesium({
          createdAt: ago(25),
          effectEndsAt: ago(13),
          changes: [],
        }),
      ).amount,
      12,
    );
  });

  it("UNKNOWN_EFFECT_DOSE: an earlier recommendation of the product in another unit cannot be added", () => {
    assert.equal(
      reasonOf(magnesium({ unit: "G", changes: [] })),
      "UNKNOWN_EFFECT_DOSE",
    );
  });
});

describe("choosing between equal products (acrobot, barracuda 33872)", () => {
  const a = row({ rowId: "r-a", productId: "p-a", productName: "A" });
  const b = row({ rowId: "r-b", productId: "p-b", productName: "B" });

  it("the one in stock first, then unknown, then out of stock", () => {
    assert.equal(
      doseOf({
        rows: [
          { ...a, inStock: false },
          { ...b, inStock: true },
        ],
      }).product.productId,
      "p-b",
    );
    assert.equal(
      doseOf({
        rows: [
          { ...a, inStock: false },
          { ...b, inStock: null },
        ],
      }).product.productId,
      "p-b",
    );
  });

  it("then the cheaper dose (price per dose unit x the amount), unknown price last", () => {
    assert.equal(
      doseOf({
        rows: [
          { ...a, inStock: true, pricePerDoseUnit: 20 },
          { ...b, inStock: true, pricePerDoseUnit: 10 },
        ],
      }).product.productId,
      "p-b",
    );
    assert.equal(
      doseOf({
        rows: [
          { ...a, inStock: true, pricePerDoseUnit: null },
          { ...b, inStock: true, pricePerDoseUnit: 10 },
        ],
      }).product.productId,
      "p-b",
    );
  });

  it("only then the product id; the price is per dose, so a pricier unit with a smaller dose can win", () => {
    assert.equal(
      doseOf({
        rows: [
          { ...b, inStock: true, pricePerDoseUnit: 10 },
          { ...a, inStock: true, pricePerDoseUnit: 10 },
        ],
      }).product.productId,
      "p-a",
    );
    // A: effect 0,25 -> 8 ml at 20 = 160; B: effect 0,5 -> 4 ml at 30 = 120
    assert.equal(
      doseOf({
        rows: [
          { ...a, inStock: true, pricePerDoseUnit: 20 },
          { ...b, effectPer100L: 0.5, inStock: true, pricePerDoseUnit: 30 },
        ],
      }).product.productId,
      "p-b",
    );
  });

  it("stock and price do not outrank fewer moved parameters", () => {
    const side = row({
      rowId: "r-c-ca",
      productId: "p-0-combo",
      productName: "Összetett",
      parameter: "KALCIUM",
      effectPer100L: 5,
      inStock: true,
      pricePerDoseUnit: 1,
    });
    const combo = {
      ...a,
      productId: "p-0-combo",
      rowId: "r-c-kh",
      inStock: true,
      pricePerDoseUnit: 1,
    };
    assert.equal(
      doseOf({
        bands: { KH: { min: 7, max: 9 }, KALCIUM: { min: 380, max: 450 } },
        rows: [combo, side, { ...b, inStock: false, pricePerDoseUnit: 999 }],
        measurements: [point("KH", 6), point("KALCIUM", 400)],
      }).product.productId,
      "p-b",
    );
  });
});

describe("the sentence never writes a zero dose", () => {
  it("INCOMPLETE_DOSE_TEMPLATE: an amount that rounds to 0 in the sentence is not a dose", () => {
    // effect 5000 per ml: 1 x 2 / 5000 = 0,0004 ml, step 0,0001
    assert.equal(
      reasonOf({ rows: [row({ effectPer100L: 5000, step: 0.0001 })] }),
      "INCOMPLETE_DOSE_TEMPLATE",
    );
  });
});

describe("a stale dose list gives no dose, and a recommendation without its product is an unknown effect (service PR)", () => {
  it("DOSE_LIST_STALE: never built, or built more than 26 hours ago; 26 hours is still fine", () => {
    assert.equal(reasonOf({ doseListBuiltAt: null }), "DOSE_LIST_STALE");
    assert.equal(reasonOf({ doseListBuiltAt: ago(26.1) }), "DOSE_LIST_STALE");
    assert.ok(doseOf({ doseListBuiltAt: ago(26) }));
    assert.ok(doseOf({ doseListBuiltAt: ago(1) }));
  });

  it("a stale list is reported before the customer is asked to measure or give the volume, but after an open proposal (which is shown again)", () => {
    assert.equal(
      reasonOf({
        doseListBuiltAt: null,
        volumeLiters: null,
        measurements: [],
      }),
      "DOSE_LIST_STALE",
    );
    assert.equal(
      reasonOf({
        doseListBuiltAt: null,
        priorRecommendations: [
          prior({
            id: "rec-open",
            status: "OPEN",
            createdAt: ago(1),
            effectEndsAt: new Date(NOW.getTime() + 11 * HOUR),
          }),
        ],
      }),
      "ACTIVE_RECOMMENDATION",
    );
  });

  it("UNKNOWN_EFFECT_DOSE: an open or expired recommendation whose product is gone (null) cannot be checked", () => {
    for (const status of ["OPEN", "EXPIRED"] as const)
      assert.equal(
        reasonOf({
          priorRecommendations: [
            prior({
              status,
              productId: null,
              createdAt: ago(20),
              effectEndsAt: ago(8),
              changes: [{ parameter: "KH", change: 0.2 }],
            }),
          ],
        }),
        "UNKNOWN_EFFECT_DOSE",
        status,
      );
    // answered (the recorded dose carries it), not given, or older than 24 hours: not this rule
    for (const over of [
      { status: "NOT_GIVEN" as const },
      { createdAt: ago(25), effectEndsAt: ago(13) },
    ])
      assert.ok(
        doseOf({
          priorRecommendations: [
            prior({
              productId: null,
              createdAt: ago(20),
              effectEndsAt: ago(8),
              changes: [{ parameter: "KH", change: 0.2 }],
              ...over,
            }),
          ],
        }),
      );
  });

  it("a side parameter with such a recommendation drops the combined product out (the pure one is taken)", () => {
    const bands = { KH: { min: 7, max: 9 }, KALCIUM: { min: 380, max: 450 } };
    const combo = [
      row({ rowId: "r-c-kh", productId: "p-combo", productName: "Összetett" }),
      row({
        rowId: "r-c-ca",
        productId: "p-combo",
        productName: "Összetett",
        parameter: "KALCIUM",
        effectPer100L: 5,
      }),
    ];
    const gone = prior({
      parameter: "KALCIUM",
      productId: null,
      createdAt: ago(20),
      effectEndsAt: ago(8),
      changes: [{ parameter: "KALCIUM", change: 5 }],
    });
    const over = {
      bands,
      measurements: [point("KH", 6), point("KALCIUM", 400)],
      priorRecommendations: [gone],
    };
    assert.equal(reasonOf({ ...over, rows: combo }), "NO_USABLE_PRODUCT");
    assert.equal(
      doseOf({
        ...over,
        rows: [
          ...combo,
          row({
            rowId: "r-pure",
            productId: "p-z-pure",
            productName: "Tiszta",
          }),
        ],
      }).product.productId,
      "p-z-pure",
    );
  });
});

describe("the text numbers", () => {
  it("huNumber: decimal comma, at most three decimals, no trailing zeros", () => {
    assert.equal(huNumber(8), "8");
    assert.equal(huNumber(6.5), "6,5");
    assert.equal(huNumber(0.1234567), "0,123");
    assert.equal(huNumber(12), "12");
  });
});
