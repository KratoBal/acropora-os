import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { suggestedLineCount } from "./expected-arrival.service.js";

// What must fail: a line without a product counted as suggested; a missing
// or malformed store counted as anything but zero.
describe("the list's suggestion count", () => {
  it("counts only the lines with a product suggestion", () => {
    assert.equal(
      suggestedLineCount([
        { result: { suggestion: { variantId: "v-1" } } },
        { result: { suggestion: null, conflict: true } },
        { result: { suggestion: { variantId: "v-2" } } },
      ]),
      2,
    );
    assert.equal(suggestedLineCount(null), 0);
    assert.equal(suggestedLineCount({ nem: "lista" }), 0);
  });
});
