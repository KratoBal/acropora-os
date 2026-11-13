import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { webshopDoseLine } from "./webshop-usage-guide.js";

describe("the dose line of the shipped mail's usage guide", () => {
  /*
    WHAT TURNS THIS RED: a decimal point instead of the Hungarian comma; a four-digit volume not grouped; "naponta egyszer"
    instead of the manufacturer line's short "naponta"; a frequency range lost; drops not written as "csepp".
  */
  it("reads the OS canonical form into korall's wording", () => {
    assert.equal(
      webshopDoseLine("5 ml/100 L/day"),
      "5 ml / 100 liter, naponta",
    );
    assert.equal(
      webshopDoseLine("0.5 ml/100 L, 3/day"),
      "0,5 ml / 100 liter, naponta 3 alkalommal",
    );
    assert.equal(
      webshopDoseLine("1 drop/1000 L, 1-2/week"),
      // the group separator is a no-break space: the number does not break across lines
      "1 csepp / 1\u00a0000 liter, hetente 1-2 alkalommal",
    );
    assert.equal(
      webshopDoseLine("12.25 ml/40 L/week"),
      "12,25 ml / 40 liter, hetente",
    );
  });

  /*
    WHAT TURNS THIS RED: a second, lenient reading of a value that is not the canonical form (a wrong dose can kill an
    animal): a range in the amount, a human spelling, a zero, a reversed or zero frequency, a fraction of a drop, not a string.
  */
  it("refuses everything that is not exactly the canonical form", () => {
    for (const value of [
      "1-2 ml/100 L/day",
      "5 ml / 100 liter, naponta",
      "5 ml/100 l/day",
      "5,5 ml/100 L/day",
      "0 ml/100 L/day",
      "5 ml/0 L/day",
      "1 drop/100 L, 2-1/week",
      "1 drop/100 L, 0/week",
      "1.5 drop/100 L/day",
      "5 ml/100 L/month",
      " 5 ml/100 L/day",
      "",
      null,
      5,
    ])
      assert.equal(webshopDoseLine(value), null, String(value));
  });
});
