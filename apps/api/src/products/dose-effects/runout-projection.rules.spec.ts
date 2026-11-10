import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  toRunOutProducts,
  type RunOutFact,
} from "./runout-projection.rules.js";

/*
  THE RUN-OUT REMINDER'S PRODUCT LIST (ReefClub V3.2, slice 4). WHAT TURNS THIS RED: a product with no accepted dose or no pack
  size in the list; a conflicting (NULL) fact counted; a test-dependent dose counted; a dose in drops, a mass pack or a pack that
  is not one number and one volume unit counted; the pack's millilitres wrong; an inactive product, or a SUGGESTED (not accepted)
  fact counted (acrobot 45512).
*/
const fact = (
  productId: string,
  field: string,
  value: string | null,
  over: Partial<RunOutFact> = {},
): RunOutFact => ({
  productId,
  productName: `Termek ${productId}`,
  productActive: true,
  field,
  value,
  status: "VERIFIED",
  ...over,
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
        // a conflict a person resolved keeps its status and has a value: it is a fact
        fact("p3", "dosing", "2 ml/100 L/day", {
          status: "CONFLICTING_SOURCES",
        }),
        fact("p3", "packSize", "250 ml"),
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
        {
          productId: "p3",
          productName: "Termek p3",
          dose: "2 ml/100 L/day",
          packageText: "250 ml",
          packageMl: 250,
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
      // an inactive product (not to be bought)
      fact("j", "dosing", "5 ml/100 L/day", { productActive: false }),
      fact("j", "packSize", "500 ml", { productActive: false }),
      // a suggested dose, or a suggested pack: a suggestion, not a fact
      fact("k", "dosing", "5 ml/100 L/day", { status: "SUGGESTED" }),
      fact("k", "packSize", "500 ml"),
      fact("l", "dosing", "5 ml/100 L/day"),
      fact("l", "packSize", "500 ml", { status: "SUGGESTED" }),
    ]);
    assert.deepEqual(left, []);
  });
});
