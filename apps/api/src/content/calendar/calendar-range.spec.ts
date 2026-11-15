import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { calendarRange } from "./calendar-range.js";

/*
  THE CALENDAR RANGE (T5.5 S1). What turns this red: an impossible day accepted because it has the shape; a reversed
  or too wide range read anyway; the range's instants taken in UTC, so the first Budapest hour of the first day and the
  last hour of the last day fall out; a daylight-saving day counted as 24 hours.
*/
describe("calendarRange", () => {
  it("refuses a day that only has the shape, a reversed range and a range wider than 92 days", () => {
    for (const [from, to] of [
      ["2026-02-30", "2026-03-02"],
      ["2026-11-1", "2026-11-02"],
      ["2026-11-20", "2026-11-19"],
      ["2026-01-01", "2026-04-03"],
    ] as const)
      assert.ok("problem" in calendarRange(from, to), `${from}..${to}`);
    assert.ok(!("problem" in calendarRange("2026-01-01", "2026-04-02")));
  });

  it("covers the Budapest days, both included, as instants and as date-column days", () => {
    const range = calendarRange("2026-11-20", "2026-11-22");
    assert.ok(!("problem" in range));
    assert.equal(range.start.toISOString(), "2026-11-19T23:00:00.000Z");
    assert.equal(range.end.toISOString(), "2026-11-22T23:00:00.000Z");
    assert.equal(range.firstDate.toISOString(), "2026-11-20T00:00:00.000Z");
    assert.equal(range.lastDate.toISOString(), "2026-11-22T00:00:00.000Z");
  });

  it("a range over the spring change ends at the right midnight (summer time, UTC+2)", () => {
    const range = calendarRange("2026-03-28", "2026-03-29");
    assert.ok(!("problem" in range));
    assert.equal(range.start.toISOString(), "2026-03-27T23:00:00.000Z");
    assert.equal(range.end.toISOString(), "2026-03-29T22:00:00.000Z");
  });
});
