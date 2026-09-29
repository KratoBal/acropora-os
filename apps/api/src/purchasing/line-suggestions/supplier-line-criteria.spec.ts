import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DESCRIPTION_CHARS,
  candidateCriterion,
  plainDescription,
} from "./supplier-line-criteria.js";

describe("the candidate text the Jev reads", () => {
  it("reads the description as plain text: no tags, no control bytes, one line", () => {
    assert.equal(
      plainDescription(
        "<p>Kerámia&nbsp;fragtalp\u0001\u0001<br>\n 10 db &amp; tartó</p>",
      ),
      "Kerámia fragtalp 10 db & tartó",
    );
    assert.equal(plainDescription(null), "");
    // the export's empty descriptions were two control bytes (2026-09-29)
    assert.equal(plainDescription("\u0001\u0001"), "");
  });

  it("keeps the first 200 characters, as measured", () => {
    const text = plainDescription("x".repeat(DESCRIPTION_CHARS + 50));
    assert.equal(text.length, DESCRIPTION_CHARS);
  });

  it("puts the description after the name, and nothing when there is none", () => {
    assert.equal(
      candidateCriterion(
        "Red Sea NO3:PO4-X 1000 ml",
        "<p>Nitrát és foszfát</p>",
        "name+description",
      ),
      "Red Sea NO3:PO4-X 1000 ml. Nitrát és foszfát",
    );
    assert.equal(
      candidateCriterion("Red Sea NO3:PO4-X 1000 ml", null, "name+description"),
      "Red Sea NO3:PO4-X 1000 ml",
    );
    assert.equal(
      candidateCriterion("Red Sea NO3:PO4-X 1000 ml", "<p>Nitrát</p>", "name"),
      "Red Sea NO3:PO4-X 1000 ml",
    );
  });
});
