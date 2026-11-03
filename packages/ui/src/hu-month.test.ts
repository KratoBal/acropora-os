import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  HU_MONTHS,
  joinMonth,
  monthName,
  monthParts,
  monthYears,
} from "./hu-month.js";

// What must fail: a month shown by the browser's English name; a half-picked month (year without
// month) handed to the caller as a month; month 13 accepted; a value outside the offered years
// that the field then cannot show; the twelve names out of order.
describe("the Hungarian month field", () => {
  it("has the twelve Hungarian month names in order", () => {
    assert.equal(HU_MONTHS.length, 12);
    assert.equal(HU_MONTHS[0], "január");
    assert.equal(HU_MONTHS[7], "augusztus");
    assert.equal(HU_MONTHS[11], "december");
  });

  it("splits a YYYY-MM value, and gives two empty parts for anything else", () => {
    assert.deepEqual(monthParts("2026-08"), { year: "2026", month: "08" });
    assert.deepEqual(monthParts(""), { year: "", month: "" });
    assert.deepEqual(monthParts(undefined), { year: "", month: "" });
    assert.deepEqual(monthParts("2026-13"), { year: "", month: "" });
    assert.deepEqual(monthParts("2026-8"), { year: "", month: "" });
    assert.deepEqual(monthParts("2026-08-03"), { year: "", month: "" });
  });

  it("joins a value only when both parts are there and valid", () => {
    assert.equal(joinMonth("2026", "08"), "2026-08");
    assert.equal(joinMonth("2026", ""), "");
    assert.equal(joinMonth("", "08"), "");
    assert.equal(joinMonth("2026", "13"), "");
    assert.equal(joinMonth("2026", "00"), "");
    assert.equal(joinMonth("26", "08"), "");
  });

  it("names a month from its two-digit number", () => {
    assert.equal(monthName("08"), "augusztus");
    assert.equal(monthName("12"), "december");
    assert.equal(monthName("13"), "");
    assert.equal(monthName(""), "");
    assert.equal(monthName("8"), "");
  });

  it("offers the years around today, newest first, and the selected year if it is outside", () => {
    const years = monthYears(2026, "");
    assert.equal(years[0], "2027");
    assert.equal(years.at(-1), "2020");
    assert.equal(years.length, 8);
    assert.ok(monthYears(2026, "2012").includes("2012"));
    assert.deepEqual(monthYears(2026, "2012").slice(-1), ["2012"]);
    assert.equal(
      monthYears(2026, "2026").filter((y) => y === "2026").length,
      1,
    );
  });
});
