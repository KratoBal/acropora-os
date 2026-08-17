import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { eanCheckDigitValid, parseBarcode } from "./barcode.util.js";

describe("parseBarcode", () => {
  it("strips the whitespace a scanner or a spreadsheet adds", () => {
    for (const raw of [
      "  5998200310010  ",
      "5998200310010\n",
      "5998 2003 10010",
      " 5998200310010 ", // non-breaking space
      "5998200310010​", // zero-width space
      "﻿5998200310010", // byte order mark
    ]) {
      const result = parseBarcode(raw);
      assert.equal(result.valid, true, `should accept: ${JSON.stringify(raw)}`);
      assert.equal(result.valid && result.code, "5998200310010");
    }
  });

  it("upper-cases internal alphanumeric codes so lookups match", () => {
    const result = parseBarcode("acr-x".replace("-", ""));
    assert.equal(result.valid && result.code, "ACRX");
  });

  it("rejects empty, too short and too long codes", () => {
    assert.equal(parseBarcode("   ").valid, false);
    assert.equal(parseBarcode("123").valid, false);
    assert.equal(parseBarcode("1".repeat(49)).valid, false);
  });

  it("rejects punctuation rather than silently dropping it", () => {
    // Silently stripping a hyphen would map two different codes onto one.
    for (const raw of ["5998-200310010", "599/8200310010", "5998,200310010"])
      assert.equal(parseBarcode(raw).valid, false, `should reject: ${raw}`);
  });

  it("reports the EAN check digit without enforcing it", () => {
    const good = parseBarcode("5998200310010");
    assert.equal(good.valid, true);
    assert.equal(good.valid && good.eanCheckDigitValid, true);

    // Last digit deliberately wrong: still accepted, but flagged.
    const bad = parseBarcode("5998200310011");
    assert.equal(bad.valid, true);
    assert.equal(bad.valid && bad.eanCheckDigitValid, false);
  });

  it("reports null for codes that are not EAN-shaped at all", () => {
    // The shop's own internal numbering is not EAN and never claimed to be -
    // "not applicable" must not look like "wrong".
    const internal = parseBarcode("ACRO12345");
    assert.equal(internal.valid, true);
    assert.equal(internal.valid && internal.eanCheckDigitValid, null);

    const oddLength = parseBarcode("1234567890");
    assert.equal(oddLength.valid && oddLength.eanCheckDigitValid, null);
  });
});

describe("eanCheckDigitValid", () => {
  it("validates every length in the EAN/UPC family", () => {
    assert.equal(eanCheckDigitValid("96385074"), true); // EAN-8
    assert.equal(eanCheckDigitValid("036000291452"), true); // UPC-A
    assert.equal(eanCheckDigitValid("5901234123457"), true); // EAN-13
    assert.equal(eanCheckDigitValid("00012345600012"), true); // GTIN-14
  });

  it("returns false for a wrong check digit", () =>
    assert.equal(eanCheckDigitValid("5901234123458"), false));

  it("returns null when the question does not apply", () => {
    assert.equal(eanCheckDigitValid("ABC12345"), null);
    assert.equal(eanCheckDigitValid("123456789"), null);
  });
});
