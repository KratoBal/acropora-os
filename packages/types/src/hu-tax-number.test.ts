import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  HU_TAX_NUMBER_PROBLEM,
  huTaxNumberProblem,
  normalizeHuTaxNumber,
} from "./hu-tax-number.js";

describe("normalizeHuTaxNumber", () => {
  it("gives the dotted stored shape for every accepted way of typing it", () => {
    for (const typed of [
      "12345678-1-42",
      "12345678142",
      "12345678 1 42",
      " 12345678-1-42 ",
      "HU12345678142",
      "hu 12345678-1-42",
      "12345678-142",
    ])
      assert.equal(normalizeHuTaxNumber(typed), "12345678-1-42", typed);
  });

  it("refuses what is not a Hungarian tax number shape", () => {
    for (const typed of [
      "",
      "1234567",
      "12345678",
      "12345678-1",
      "12345678-1-4",
      "12345678-1-423",
      "1234567a-1-42",
      "SK2020123456",
      "DE123456789",
      "12345678-1-42-9",
    ])
      assert.equal(normalizeHuTaxNumber(typed), null, typed);
  });
});

describe("huTaxNumberProblem", () => {
  it("is silent for an empty value (the tax number is optional here) and for a good one", () => {
    assert.equal(huTaxNumberProblem(undefined), null);
    assert.equal(huTaxNumberProblem(null), null);
    assert.equal(huTaxNumberProblem("   "), null);
    assert.equal(huTaxNumberProblem("12345678-2-13"), null);
  });

  it("gives the sentence for a bad one, pointing a foreign company to the EU field", () => {
    assert.equal(huTaxNumberProblem("1234"), HU_TAX_NUMBER_PROBLEM);
    assert.match(HU_TAX_NUMBER_PROBLEM, /közösségi adószám/);
  });
});
