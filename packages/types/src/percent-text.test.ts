import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { trimPercentText } from "./percent-text.js";

/*
  A SZÁZALÉK FELIRATA (Luca, 2026-11-17: „a 60%-ot 6%-nak veszi át”). MI PIROSIT: ha egy kerek, nullára végződő százalék (10, 20, 40, 50,
  60, 100) a tizedespont nélküli szövegből a nulláját elvesztené; ha a tizedes utáni felesleges nulla megmaradna ("60.00"); ha egy
  valódi tizedes jegy elveszne ("62.5", "33.33", "0.5").
*/
describe("trimPercentText", () => {
  it("a kerek százalék tizedespont nélkül változatlan: a nulla nem vágódik le (a 6%-os hiba)", () => {
    for (const value of [
      "10",
      "20",
      "30",
      "40",
      "50",
      "60",
      "70",
      "80",
      "90",
      "100",
    ])
      assert.equal(trimPercentText(value), value, value);
  });

  it("a tizedes utáni felesleges nullák elmennek, a kerek érték marad", () => {
    assert.equal(trimPercentText("60.00"), "60");
    assert.equal(trimPercentText("40.0"), "40");
    assert.equal(trimPercentText("100.000"), "100");
    assert.equal(trimPercentText("62.50"), "62.5");
  });

  it("a valódi tizedes jegy megmarad, a kerek tört is", () => {
    assert.equal(trimPercentText("62.5"), "62.5");
    assert.equal(trimPercentText("33.33"), "33.33");
    assert.equal(trimPercentText("0.5"), "0.5");
    assert.equal(trimPercentText("7.25"), "7.25");
  });

  it("CONTROL: az egyjegyű és a nulla maga is ép, a körülvevő szóköz leesik", () => {
    assert.equal(trimPercentText("6"), "6");
    assert.equal(trimPercentText("5"), "5");
    assert.equal(trimPercentText("0"), "0");
    assert.equal(trimPercentText(" 60 "), "60");
  });
});
