import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isOutsideMeasurementRange,
  measurementDistanceFromRange,
  measurementStatus,
  measurementTrend,
  type MeasurementRange,
} from "./aquarium-measurement-evaluation.js";

/*
  What turns these red: the shared in/out check drawing a different verdict
  than the inline check the screens had before (any value, any range,
  including NaN, infinities and one-sided or missing ranges); a tolerance
  creeping into the in/out check; the D1 and D2 rules moving off their
  documented thresholds.
*/

/** The check the four screens carried inline before this slice, verbatim. */
const screenCheckBefore = (
  value: number,
  range: MeasurementRange | undefined,
) =>
  range !== undefined &&
  ((range.min !== undefined && value < range.min) ||
    (range.max !== undefined && value > range.max));

const VALUES = [
  Number.NEGATIVE_INFINITY,
  -1,
  -0,
  0,
  1e-10,
  0.5,
  7.2,
  7.8,
  7.8 - 1e-12,
  8.1,
  8.4,
  8.4 + 1e-12,
  9,
  1000,
  Number.POSITIVE_INFINITY,
  Number.NaN,
];
const BOUNDS = [undefined, -1, 0, 7.8, 8.4, 1000];
const RANGES: (MeasurementRange | undefined)[] = [undefined];
for (const min of BOUNDS) for (const max of BOUNDS) RANGES.push({ min, max });

describe("isOutsideMeasurementRange", () => {
  it("draws the same verdict as the screens' inline check on the whole grid", () => {
    // Positive control on the grid itself: without it an empty grid passes.
    assert.equal(VALUES.length * RANGES.length, 16 * 37);
    let outside = 0;
    for (const range of RANGES)
      for (const value of VALUES) {
        const before = screenCheckBefore(value, range);
        assert.equal(
          isOutsideMeasurementRange(value, range),
          before,
          `value ${value}, range ${JSON.stringify(range)}`,
        );
        if (before) outside++;
      }
    // Both verdicts occur, so the comparison is not one-sided.
    assert.ok(outside > 0 && outside < VALUES.length * RANGES.length);
  });

  it("has no tolerance: 1e-12 past a bound is outside, unlike the D1 status", () => {
    const range = { min: 7.8, max: 8.4 };
    assert.equal(isOutsideMeasurementRange(8.4 + 1e-12, range), true);
    assert.equal(measurementStatus(8.4 + 1e-12, range), "OK");
  });

  it("no range is never outside", () => {
    assert.equal(isOutsideMeasurementRange(1e9, undefined), false);
    assert.equal(isOutsideMeasurementRange(1e9, {}), false);
  });
});

describe("measurementDistanceFromRange", () => {
  it("gives the side and the distance, 0 inside", () => {
    assert.deepEqual(measurementDistanceFromRange(7, { min: 7.8 }), {
      distance: 0.7999999999999998,
      direction: "LOW",
    });
    assert.deepEqual(measurementDistanceFromRange(9, { max: 8.4 }), {
      distance: 0.5999999999999996,
      direction: "HIGH",
    });
    assert.deepEqual(measurementDistanceFromRange(8, { min: 7.8, max: 8.4 }), {
      distance: 0,
      direction: null,
    });
  });
});

describe("measurementStatus (D1)", () => {
  const range = { min: 7.8, max: 8.4 };
  it("inside OK, less than the width out WARN, the width or more ALERT", () => {
    assert.equal(measurementStatus(8.1, range), "OK");
    assert.equal(measurementStatus(7.5, range), "WARN");
    // Exactly the width (0.6) away: ALERT, despite the float difference.
    assert.equal(measurementStatus(7.2, range), "ALERT");
    assert.equal(measurementStatus(9.1, range), "ALERT");
  });

  it("a one-sided range uses 10% of its bound as the width; a bound of 0 has none", () => {
    assert.equal(measurementStatus(380, { min: 400 }), "WARN");
    assert.equal(measurementStatus(360, { min: 400 }), "ALERT");
    assert.equal(measurementStatus(0.01, { max: 0 }), "ALERT");
  });
});

describe("measurementTrend (D2)", () => {
  const range = { min: 7.8, max: 8.4 };
  it("closer is IMPROVING, farther WORSENING, same or both inside STABLE", () => {
    assert.equal(measurementTrend(7.6, undefined, range), null);
    assert.equal(measurementTrend(7.6, 7.4, range), "IMPROVING");
    assert.equal(measurementTrend(7.4, 7.6, range), "WORSENING");
    assert.equal(measurementTrend(8.0, 8.2, range), "STABLE");
    assert.equal(measurementTrend(7.6, 8.6, range), "STABLE");
  });
});
