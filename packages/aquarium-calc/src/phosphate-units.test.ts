import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PHOSPHATE_MOLAR_MASS,
  convertPhosphate,
  parsePhosphateUnit,
  toMgPerLitrePo4,
  type PhosphateBasis,
  type PhosphateUnit,
} from "./phosphate-units.js";

/**
 * Reference values are computed by hand from the IUPAC 2021 atomic weights
 * (P = 30.974, O = 15.999), not by re-running the function: PO4 = 94.970 g/mol.
 */
const close = (actual: number, expected: number, tolerance: number) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} is not within ${tolerance} of ${expected}`,
  );

describe("phosphate molar masses", () => {
  it("PO4 is 94.970 g/mol and P is 30.974 g/mol", () => {
    close(PHOSPHATE_MOLAR_MASS.PO4, 94.97, 1e-9);
    close(PHOSPHATE_MOLAR_MASS.P, 30.974, 1e-9);
  });
});

describe("convertPhosphate", () => {
  it("1 µmol/l is 0.09497 mg/l PO4 and 0.030974 mg/l P", () => {
    const q = { value: 1, unit: "µmol/l", basis: "PO4" } as const;
    close(convertPhosphate(q, "mg/l", "PO4"), 0.09497, 1e-9);
    close(convertPhosphate(q, "mg/l", "P"), 0.030974, 1e-9);
  });

  it("1 mg/l P is 3.066 mg/l PO4 (94.970 / 30.974)", () => {
    close(
      toMgPerLitrePo4({ value: 1, unit: "mg/l", basis: "P" }),
      3.06612,
      1e-5,
    );
  });

  it("0.03 mg/l PO4 is 0.316 µmol/l (0.03 x 1000 / 94.970)", () => {
    close(
      convertPhosphate(
        { value: 0.03, unit: "mg/l", basis: "PO4" },
        "µmol/l",
        "PO4",
      ),
      0.31589,
      1e-5,
    );
  });

  /**
   * An independent cross-check from the hobby side: an ultra-low-range
   * phosphorus checker reads ppb P, and the usual conversion to ppm PO4 is
   * "multiply by 3.066 and divide by 1000". 10 ppb P -> 0.03066 mg/l PO4.
   */
  it("10 ppb P is 0.03066 mg/l PO4, the ULR checker conversion", () => {
    close(
      toMgPerLitrePo4({ value: 10, unit: "ppb", basis: "P" }),
      0.030661,
      1e-6,
    );
  });

  it("ppm reads as mg/l and ppb as µg/l", () => {
    for (const basis of ["PO4", "P"] as const) {
      close(
        toMgPerLitrePo4({ value: 0.05, unit: "ppm", basis }),
        toMgPerLitrePo4({ value: 0.05, unit: "mg/l", basis }),
        1e-12,
      );
      close(
        toMgPerLitrePo4({ value: 30, unit: "ppb", basis }),
        toMgPerLitrePo4({ value: 30, unit: "µg/l", basis }),
        1e-12,
      );
    }
    close(
      toMgPerLitrePo4({ value: 30, unit: "ppb", basis: "PO4" }),
      0.03,
      1e-12,
    );
  });

  it("a P value read as PO4 gives a different number (the wrong-basis mistake is visible)", () => {
    const asP = toMgPerLitrePo4({ value: 0.1, unit: "mg/l", basis: "P" });
    const misreadAsPo4 = toMgPerLitrePo4({
      value: 0.1,
      unit: "mg/l",
      basis: "PO4",
    });
    close(asP, 0.306612, 1e-6);
    close(misreadAsPo4, 0.1, 1e-12);
    assert.ok(
      asP / misreadAsPo4 > 3,
      `the bases differ by a factor of ${asP / misreadAsPo4}`,
    );
  });

  it("the basis does not change a molar value", () => {
    const fromPo4 = convertPhosphate(
      { value: 2, unit: "µmol/l", basis: "PO4" },
      "mg/l",
      "PO4",
    );
    const fromP = convertPhosphate(
      { value: 2, unit: "µmol/l", basis: "P" },
      "mg/l",
      "PO4",
    );
    assert.equal(fromPo4, fromP);
  });

  const units: PhosphateUnit[] = ["µmol/l", "mg/l", "µg/l", "ppm", "ppb"];
  const bases: PhosphateBasis[] = ["PO4", "P"];
  for (const from of units)
    for (const fromBasis of bases)
      for (const to of units)
        for (const toBasis of bases)
          it(`round trip ${from} ${fromBasis} -> ${to} ${toBasis} -> back`, () => {
            const start = { value: 0.0425, unit: from, basis: fromBasis };
            const there = convertPhosphate(start, to, toBasis);
            const back = convertPhosphate(
              { value: there, unit: to, basis: toBasis },
              from,
              fromBasis,
            );
            close(back, 0.0425, 1e-12);
          });

  it("refuses a negative or non-finite value", () => {
    for (const value of [-0.01, Number.NaN, Number.POSITIVE_INFINITY])
      assert.throws(
        () => toMgPerLitrePo4({ value, unit: "mg/l", basis: "PO4" }),
        RangeError,
      );
  });
});

describe("parsePhosphateUnit", () => {
  it("accepts the micro sign, the Greek mu and the ASCII u", () => {
    for (const spelling of ["µmol/l", "μmol/l", "umol/L", "µM", "μM", "uM"])
      assert.equal(parsePhosphateUnit(spelling), "µmol/l", spelling);
    for (const spelling of ["µg/l", "μg/L", "ug/l"])
      assert.equal(parsePhosphateUnit(spelling), "µg/l", spelling);
  });

  it("accepts mg/l, ppm and ppb", () => {
    assert.equal(parsePhosphateUnit("mg/L"), "mg/l");
    assert.equal(parsePhosphateUnit(" ppm "), "ppm");
    assert.equal(parsePhosphateUnit("ppb"), "ppb");
  });

  it("does not guess an unknown or incomplete unit", () => {
    for (const spelling of ["mg", "mmol/l", "mg/kg", "nM", "%", ""])
      assert.equal(parsePhosphateUnit(spelling), null, spelling);
  });
});
