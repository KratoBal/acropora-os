import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  customerSearchPattern,
  taxNumberSearchKey,
} from "./customers.repository.js";

// THE RAW SEARCH ESCAPES WHAT LIKE WOULD READ AS A WILDCARD. The Prisma
// `contains` path before it did not (measured on the calibration branch:
// "100% Kft" also found "1000 Kft"). What must fail: a `%` or `_` reaching LIKE unescaped (the
// search "100%" would then match every "100…"), or a backslash left alone (it
// would escape the next character instead of standing for itself).
describe("customerSearchPattern", () => {
  it("wraps the trimmed text to match anywhere", () => {
    assert.equal(customerSearchPattern("  Főv "), "%Főv%");
  });

  it("escapes the two wildcards and the escape character", () => {
    assert.equal(customerSearchPattern("100%"), "%100\\%%");
    assert.equal(customerSearchPattern("a_b"), "%a\\_b%");
    assert.equal(customerSearchPattern("a\\b"), "%a\\\\b%");
  });
});

describe("taxNumberSearchKey (acrobot 28132)", () => {
  it("drops the separators, so every typed form is the same key", () => {
    assert.deepEqual(
      ["12345678-2-42", "12345678242", " 1234 5678 2 42 ", "hu12345678"].map(
        taxNumberSearchKey,
      ),
      ["12345678242", "12345678242", "12345678242", "HU12345678"],
    );
  });

  it("a name or a short text is not a tax number", () => {
    assert.deepEqual(["Adapt Kft", "12", "a-1"].map(taxNumberSearchKey), [
      null,
      null,
      null,
    ]);
  });
});
