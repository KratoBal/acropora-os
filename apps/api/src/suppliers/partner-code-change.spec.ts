import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { partnerCodeChange } from "./partner-code-change.js";

/**
 * The whole point of this function is the difference between "not mentioned"
 * and "cleared". Every case is listed rather than sampled: the two that matter
 * (`undefined` on a partner that has a code, `null` on the same partner) look
 * alike in a payload and mean opposite things.
 */
describe("what a save does to the partner code", () => {
  it("leaves the stored code alone when the field is not in the request", () => {
    assert.equal(partnerCodeChange("FANK", undefined), "unchanged");
    assert.equal(partnerCodeChange(null, undefined), "unchanged");
  });

  it("calls the same value unchanged, so a save does not lock itself out", () => {
    // This is what lets a partner edit its phone number without the code
    // rules firing: the code did not move, so nothing is checked against the
    // numbers it may have produced.
    assert.equal(partnerCodeChange("FANK", "FANK"), "unchanged");
    assert.equal(partnerCodeChange("FANK", " FANK "), "unchanged");
  });

  it("separates the first code from a replacement", () => {
    assert.equal(partnerCodeChange(null, "FANK"), "set");
    assert.equal(partnerCodeChange("FANK", "BIOD"), "changed");
  });

  it("treats an explicit null as clearing, and only if there was one", () => {
    assert.equal(partnerCodeChange("FANK", null), "cleared");
    assert.equal(partnerCodeChange(null, null), "unchanged");
  });

  /**
   * The DTO pattern refuses an empty string, so this cannot arrive today. It is
   * pinned anyway, because "" is the shape a form sends when a field is emptied
   * and a future caller may stop trimming on the way in -- and the wrong answer
   * here ("set" to an empty code) would put an empty string into a unique
   * column, where two partners "without a code" would collide.
   */
  it("reads an emptied string as clearing, not as a new code", () => {
    assert.equal(partnerCodeChange("FANK", ""), "cleared");
    assert.equal(partnerCodeChange(null, ""), "unchanged");
  });
});
