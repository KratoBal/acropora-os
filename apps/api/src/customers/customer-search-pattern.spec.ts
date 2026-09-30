import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { customerSearchPattern } from "./customers.repository.js";

// THE RAW SEARCH ESCAPES WHAT LIKE WOULD READ AS A WILDCARD. Prisma's
// `contains` escaped `%` and `_` for us; the accent-insensitive raw query has
// to do it itself. What must fail: a `%` or `_` reaching LIKE unescaped (the
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
