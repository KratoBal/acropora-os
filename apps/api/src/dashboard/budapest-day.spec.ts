import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { budapestDayKey, startOfBudapestDay } from "./budapest-day.js";

describe("Budapest calendar days", () => {
  it("an instant after midnight Budapest time is already the next day", () => {
    // 23:30 UTC on 30 Sep = 01:30 on 1 Oct in Budapest (CEST, +2)
    assert.equal(
      budapestDayKey(new Date("2026-09-30T23:30:00Z")),
      "2026-10-01",
    );
    assert.equal(
      budapestDayKey(new Date("2026-09-30T21:59:59Z")),
      "2026-09-30",
    );
  });

  it("the start of a summer and a winter day", () => {
    const now = new Date("2026-10-01T10:00:00Z");
    assert.equal(
      startOfBudapestDay(now).toISOString(),
      "2026-09-30T22:00:00.000Z",
    );
    assert.equal(
      startOfBudapestDay(now, 1).toISOString(),
      "2026-10-01T22:00:00.000Z",
    );
    const winter = new Date("2026-12-10T10:00:00Z");
    assert.equal(
      startOfBudapestDay(winter).toISOString(),
      "2026-12-09T23:00:00.000Z",
    );
  });

  it("crosses both DST changes correctly", () => {
    // clocks go back on 25 Oct 2026: the 26th starts at 23:00 UTC on the 25th
    const beforeBack = new Date("2026-10-24T12:00:00Z");
    assert.equal(
      startOfBudapestDay(beforeBack, 1).toISOString(),
      "2026-10-24T22:00:00.000Z",
    );
    assert.equal(
      startOfBudapestDay(beforeBack, 2).toISOString(),
      "2026-10-25T23:00:00.000Z",
    );
    // clocks go forward on 29 Mar 2026
    const beforeForward = new Date("2026-03-28T12:00:00Z");
    assert.equal(
      startOfBudapestDay(beforeForward, 1).toISOString(),
      "2026-03-28T23:00:00.000Z",
    );
    assert.equal(
      startOfBudapestDay(beforeForward, 2).toISOString(),
      "2026-03-29T22:00:00.000Z",
    );
  });
});
