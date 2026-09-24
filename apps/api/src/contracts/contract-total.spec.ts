import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { contractItemYearlyNet } from "./contract-total.js";

describe("contract yearly total", () => {
  it("a szerződés éves díja Decimal: egységár × db × alkalom", () => {
    const total = contractItemYearlyNet({
      unitNet: "0.1",
      quantity: "3",
      occasionsPerYear: 7,
    });

    // JavaScript floattal ez 2.1000000000000005 lenne. A pénzösszegnek nem
    // szabad a képernyőn vagy a későbbi igazoláson ilyen értékké válnia.
    assert.equal(total.toFixed(2), "2.10");
  });
});
