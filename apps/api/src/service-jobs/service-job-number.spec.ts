import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { nextServiceJobNumber } from "./service-job-number.js";

describe("a hibajegy száma", () => {
  it("az év első jegye 001", () => {
    assert.equal(
      nextServiceJobNumber({ year: 2026, lastNumber: null }),
      "HJ-2026-001",
    );
  });

  it("a következő eggyel több, azonos hosszon", () => {
    assert.equal(
      nextServiceJobNumber({ year: 2026, lastNumber: "HJ-2026-009" }),
      "HJ-2026-010",
    );
  });

  it("a százas határon sem veszít jegyet", () => {
    assert.equal(
      nextServiceJobNumber({ year: 2026, lastNumber: "HJ-2026-099" }),
      "HJ-2026-100",
    );
    assert.equal(
      nextServiceJobNumber({ year: 2026, lastNumber: "HJ-2026-999" }),
      "HJ-2026-1000",
    );
  });

  /**
   * EGY NEM ÉRTELMEZHETŐ SZÁM NEM NULLÁZZA A SZÁMLÁLÓT.
   *
   * A csendes visszaesés 001-re két jegyet adna ugyanazzal a számmal, és azt
   * utólag nem lehet szétválasztani - egy dobott hívás hangos, egy ütköző
   * jegyszám néma.
   */
  it("nem értelmezhető előzménynél dob, nem kezd újra", () => {
    assert.throws(() =>
      nextServiceJobNumber({ year: 2026, lastNumber: "HJ-2026-XYZ" }),
    );
  });
});
