import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { nextCompletionCertificateNumber } from "./completion-certificate-number.js";

describe("a teljesítési igazolás száma", () => {
  it("az év első jegye 001", () => {
    assert.equal(
      nextCompletionCertificateNumber({ year: 2026, lastNumber: null }),
      "TI-2026-001",
    );
  });

  it("a következő eggyel több, azonos hosszon", () => {
    assert.equal(
      nextCompletionCertificateNumber({
        year: 2026,
        lastNumber: "TI-2026-009",
      }),
      "TI-2026-010",
    );
  });

  it("a százas határon sem veszít jegyet", () => {
    assert.equal(
      nextCompletionCertificateNumber({
        year: 2026,
        lastNumber: "TI-2026-999",
      }),
      "TI-2026-1000",
    );
  });

  it("nem értelmezhető előzménynél dob, nem kezd újra", () => {
    assert.throws(() =>
      nextCompletionCertificateNumber({
        year: 2026,
        lastNumber: "TI-2026-XYZ",
      }),
    );
  });
});
