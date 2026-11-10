import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  toRunOutProducts,
  type RunOutFact,
} from "./runout-projection.rules.js";

/*
  THE RUN-OUT REMINDER'S PRODUCT LIST (ReefClub V3.2, slice 4). WHAT TURNS THIS RED: a product with no accepted dose or no pack
  size in the list; a conflicting (NULL) fact counted; a test-dependent dose counted; a dose in drops, a mass pack or a pack that
  is not one number and one volume unit counted; the pack's millilitres wrong.
*/
const fact = (
  productId: string,
  field: string,
  value: string | null,
): RunOutFact => ({
  productId,
  productName: `Termek ${productId}`,
  field,
  value,
});

describe("toRunOutProducts", () => {
  it("lists a product with an accepted millilitre dose and a strict volume pack, with the pack's millilitres", () => {
    assert.deepEqual(
      toRunOutProducts([
        fact("p1", "dosing", "5 ml/100 L/day"),
        fact("p1", "packSize", "500 ml"),
        fact("p2", "dosing", "1 ml/100 L, 1-2/week"),
        fact("p2", "packSize", "1 l"),
        fact("p2", "dosingMode", "FIXED"),
      ]),
      [
        {
          productId: "p1",
          productName: "Termek p1",
          dose: "5 ml/100 L/day",
          packageText: "500 ml",
          packageMl: 500,
        },
        {
          productId: "p2",
          productName: "Termek p2",
          dose: "1 ml/100 L, 1-2/week",
          packageText: "1 l",
          packageMl: 1000,
        },
      ],
    );
  });

  it("leaves out, without a guess, every product it cannot count", () => {
    const left = toRunOutProducts([
      // no pack size
      fact("a", "dosing", "5 ml/100 L/day"),
      // no dose
      fact("b", "packSize", "500 ml"),
      // a conflict is a NULL value
      fact("c", "dosing", null),
      fact("c", "packSize", "500 ml"),
      // test-dependent
      fact("d", "dosing", "5 ml/100 L/day"),
      fact("d", "packSize", "500 ml"),
      fact("d", "dosingMode", "TEST_DEPENDENT"),
      // drops
      fact("e", "dosing", "1 drop/100 L/day"),
      fact("e", "packSize", "50 ml"),
      // a mass pack, a loose label, two packs
      fact("f", "dosing", "5 ml/100 L/day"),
      fact("f", "packSize", "500 g"),
      fact("g", "dosing", "5 ml/100 L/day"),
      fact("g", "packSize", "~500 ml"),
      fact("h", "dosing", "5 ml/100 L/day"),
      fact("h", "packSize", "2 x 500 ml"),
      // an empty value
      fact("i", "dosing", "5 ml/100 L/day"),
      fact("i", "packSize", "  "),
    ]);
    assert.deepEqual(left, []);
  });
});
