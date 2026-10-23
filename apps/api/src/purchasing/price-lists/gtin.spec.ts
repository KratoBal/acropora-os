import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeGtin } from "./gtin.js";

describe("normalizeGtin", () => {
  it("pads EAN-13, UPC-A and EAN-8 to GTIN-14", () => {
    assert.equal(normalizeGtin("4006381333931"), "04006381333931");
    assert.equal(normalizeGtin("036000291452"), "00036000291452");
    assert.equal(normalizeGtin("96385074"), "00000096385074");
    assert.equal(normalizeGtin("04006381333931"), "04006381333931");
  });

  it("reads a UPC-A written with a leading zero as the same code as the 12-digit one", () => {
    assert.equal(normalizeGtin("0036000291452"), normalizeGtin("036000291452"));
  });

  it("does not judge the check digit: an exact equality of two written codes must survive", () => {
    assert.equal(normalizeGtin("4006381333932"), "04006381333932");
  });

  it("refuses the odd lengths and non-digits the price lists contain", () => {
    for (const bad of [
      "",
      "   ",
      "1234",
      "40063813339",
      "ABC4006381333931",
      "4006381333931 EUR",
      "GTIN",
    ])
      assert.equal(normalizeGtin(bad), null, bad);
    assert.equal(normalizeGtin(null), null);
    assert.equal(normalizeGtin(undefined), null);
  });
});
