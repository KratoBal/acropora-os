import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  computeWorksheetLineAmounts,
  sumWorksheetAmounts,
} from "./worksheet-amounts.js";

describe("worksheet amounts", () => {
  it("computes a line from quantity, unit price and VAT rate", () => {
    const amounts = computeWorksheetLineAmounts({
      quantity: 3,
      unitNet: 12500,
      vatRatePercent: 27,
    });
    assert.equal(amounts.netAmount.toString(), "37500");
    assert.equal(amounts.vatAmount.toString(), "10125");
    assert.equal(amounts.grossAmount.toString(), "47625");
  });

  it("handles a fractional quantity without floating point drift", () => {
    const amounts = computeWorksheetLineAmounts({
      quantity: "1.5",
      unitNet: "8500.5",
      vatRatePercent: 27,
    });
    assert.equal(amounts.netAmount.toString(), "12750.75");
    assert.equal(amounts.vatAmount.toString(), "3442.7025");
    assert.equal(
      amounts.grossAmount.toString(),
      amounts.netAmount.plus(amounts.vatAmount).toString(),
    );
  });

  it("derives VAT from the shown net amount, so the three printed numbers add up", () => {
    const amounts = computeWorksheetLineAmounts({
      quantity: "0.333333",
      unitNet: "1000",
      vatRatePercent: 27,
    });
    assert.equal(amounts.netAmount.toString(), "333.333");
    assert.equal(
      amounts.netAmount.plus(amounts.vatAmount).toString(),
      amounts.grossAmount.toString(),
    );
  });

  it("totals the rounded line amounts, not the raw products", () => {
    const lines = [
      computeWorksheetLineAmounts({
        quantity: "0.00005",
        unitNet: "1",
        vatRatePercent: 27,
      }),
      computeWorksheetLineAmounts({
        quantity: "0.00005",
        unitNet: "1",
        vatRatePercent: 27,
      }),
    ];
    const total = sumWorksheetAmounts(lines);
    // Soronként 0.0001-re kerekít (0.00005 -> 0.0001), tehát a lapon
    // felsorolt két tétel összege 0.0002 - és a végösszeg is ennyi.
    assert.equal(lines[0]?.netAmount.toString(), "0.0001");
    assert.equal(total.netAmount.toString(), "0.0002");
  });

  it("sums an empty worksheet to zero", () => {
    const total = sumWorksheetAmounts([]);
    assert.equal(total.netAmount.toString(), "0");
    assert.equal(total.vatAmount.toString(), "0");
    assert.equal(total.grossAmount.toString(), "0");
  });
});
