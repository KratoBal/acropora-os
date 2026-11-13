import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  dateKey,
  dateOnly,
  dayAuditValue,
  dayView,
  sameAuditValue,
  scheduleView,
  weekAuditValue,
} from "./attendance-records.js";

/*
  WHAT TURNS THIS RED. A date column read back as another day (a zone shift turns 13 November into the 12th); a week not in
  weekday order (Monday first), so the same schedule saved twice looks changed; minutes shown instead of "HH:MM" in the views
  or the audit values; a changed time, kind or weekday taken as "the same" (the change would not be written or logged), or
  the same value in another row order taken as a change (every save would log one).
*/
describe("the attendance records", () => {
  it("keeps a date as the same calendar day both ways", () => {
    assert.equal(dateKey(dateOnly("2026-11-13")), "2026-11-13");
    assert.equal(
      dateOnly("2026-03-29").toISOString(),
      "2026-03-29T00:00:00.000Z",
    );
  });

  it("shows a schedule Monday first, in HH:MM", () => {
    assert.deepEqual(
      scheduleView({
        validFrom: dateOnly("2026-11-01"),
        updatedAt: new Date("2026-11-13T09:00:00.000Z"),
        days: [
          { weekday: 5, startMinute: 420, endMinute: 900 },
          { weekday: 1, startMinute: 420, endMinute: 960 },
        ],
      }),
      {
        validFrom: "2026-11-01",
        days: [
          { weekday: 1, start: "07:00", end: "16:00" },
          { weekday: 5, start: "07:00", end: "15:00" },
        ],
        updatedAt: "2026-11-13T09:00:00.000Z",
      },
    );
  });

  it("shows a day with its times or none", () => {
    const updatedAt = new Date("2026-11-13T09:00:00.000Z");
    assert.deepEqual(
      dayView({
        date: dateOnly("2026-11-13"),
        kind: "WORKED",
        startMinute: 420,
        endMinute: 1080,
        updatedAt,
      }),
      {
        date: "2026-11-13",
        kind: "WORKED",
        start: "07:00",
        end: "18:00",
        updatedAt: "2026-11-13T09:00:00.000Z",
      },
    );
    assert.deepEqual(
      dayView({
        date: dateOnly("2026-11-14"),
        kind: "SICK",
        startMinute: null,
        endMinute: null,
        updatedAt,
      }),
      {
        date: "2026-11-14",
        kind: "SICK",
        start: null,
        end: null,
        updatedAt: "2026-11-13T09:00:00.000Z",
      },
    );
  });

  it("tells a change from a resave", () => {
    const week = [
      { weekday: 1, startMinute: 420, endMinute: 960 },
      { weekday: 2, startMinute: 420, endMinute: 960 },
    ];
    assert.ok(
      sameAuditValue(weekAuditValue(week), weekAuditValue([...week].reverse())),
    );
    assert.ok(
      !sameAuditValue(
        weekAuditValue(week),
        weekAuditValue([week[0]!, { ...week[1]!, endMinute: 961 }]),
      ),
    );
    assert.ok(
      !sameAuditValue(
        weekAuditValue(week),
        weekAuditValue([week[0]!, { ...week[1]!, weekday: 3 }]),
      ),
    );
    assert.ok(!sameAuditValue(weekAuditValue([]), weekAuditValue(null)));

    const sick = { kind: "SICK" as const, startMinute: null, endMinute: null };
    assert.deepEqual(dayAuditValue(sick), {
      kind: "SICK",
      start: null,
      end: null,
    });
    assert.ok(sameAuditValue(dayAuditValue(sick), dayAuditValue({ ...sick })));
    assert.ok(
      !sameAuditValue(
        dayAuditValue(sick),
        dayAuditValue({ ...sick, kind: "LEAVE" }),
      ),
    );
    assert.ok(
      !sameAuditValue(
        dayAuditValue({ kind: "WORKED", startMinute: 420, endMinute: 960 }),
        dayAuditValue({ kind: "WORKED", startMinute: 420, endMinute: 1020 }),
      ),
    );
    assert.equal(dayAuditValue(null), null);
  });
});
