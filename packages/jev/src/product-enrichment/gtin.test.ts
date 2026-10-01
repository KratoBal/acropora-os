import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { gtinCheckDigit, validateGtin } from "./gtin.js";

describe("GTIN / EAN validation (Tier C)", () => {
  it("accepts a valid EAN-13, EAN-8, UPC-A and GTIN-14", () => {
    const cases = [
      ["4006381333931", "GTIN-13"],
      ["5901234123457", "GTIN-13"],
      ["96385074", "GTIN-8"],
      ["036000291452", "GTIN-12"],
      ["10012345678902", "GTIN-14"],
    ] as const;
    for (const [code, kind] of cases) {
      const r = validateGtin(code);
      assert.ok(r.ok, code);
      assert.equal(r.kind, kind);
      assert.equal(r.gtin14.length, 14);
    }
  });

  it("rejects every single-digit change of a valid EAN-13 (the check digit catches it)", () => {
    const valid = "4006381333931";
    for (let i = 0; i < valid.length; i++) {
      for (let d = 0; d <= 9; d++) {
        if (String(d) === valid[i]) continue;
        const mutated = valid.slice(0, i) + d + valid.slice(i + 1);
        assert.equal(validateGtin(mutated).ok, false, mutated);
      }
    }
  });

  it("rejects a wrong check digit and names both digits", () => {
    const r = validateGtin("4006381333932");
    assert.equal(r.ok, false);
    assert.match(
      !r.ok ? r.reason : "",
      /check digit 2 does not match the computed 1/,
    );
  });

  it("rejects non-GTIN lengths, letters, hyphens, empty and all-zero input", () => {
    for (const bad of [
      "",
      "   ",
      "400638133393",
      "40063813339310",
      "1234567",
      "400638133393X",
      "4006381-333931",
      "00000000",
      "0000000000000",
    ])
      assert.equal(validateGtin(bad).ok, false, JSON.stringify(bad));
  });

  it("forgives whitespace only, and compares UPC-A and its EAN-13 form as one GTIN", () => {
    const spaced = validateGtin(" 5 901234 123457 ");
    assert.ok(spaced.ok);
    assert.equal(spaced.code, "5901234123457");

    const upc = validateGtin("036000291452");
    const ean = validateGtin("0036000291452");
    assert.ok(upc.ok && ean.ok);
    assert.equal(upc.gtin14, ean.gtin14);
  });

  it("flags the restricted-circulation (in-store) range without rejecting it", () => {
    const r = validateGtin("2001234567893");
    assert.ok(r.ok);
    assert.equal(r.restrictedCirculation, true);
    const m = validateGtin("4006381333931");
    assert.ok(m.ok);
    assert.equal(m.restrictedCirculation, false);
  });

  it("computes the GS1 check digit", () => {
    assert.equal(gtinCheckDigit("400638133393"), 1);
    assert.equal(gtinCheckDigit("9638507"), 4);
    assert.equal(gtinCheckDigit("03600029145"), 2);
  });
});
