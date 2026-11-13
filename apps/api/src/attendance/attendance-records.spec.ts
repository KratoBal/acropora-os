import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { attendanceSheet } from "@acropora/types";

import {
  dateKey,
  dateOnly,
  dayAuditValue,
  dayView,
  sameAuditValue,
  scheduleView,
  sheetContentHash,
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

describe("the signed copy's hash (S2d, barracuda on #2513)", () => {
  const sheet = attendanceSheet({
    now: new Date("2030-01-01T12:00:00.000Z"),
    month: "2026-11",
    schedules: [
      {
        validFrom: "2026-10-01",
        days: [1, 2, 3, 4, 5].map((weekday) => ({
          weekday,
          start: "07:00",
          end: "16:00",
        })),
        updatedAt: "2026-10-01T08:00:00.000Z",
      },
    ],
    entries: [],
  });

  it("follows what the page prints, not the row object", () => {
    const base = sheetContentHash(sheet);
    assert.match(base, /^[0-9a-f]{64}$/);
    // a field the page does not print: the decree's name, an internal source on a rest day
    assert.equal(
      sheetContentHash({ ...sheet, swapsDecree: "másik rendelet" }),
      base,
    );
    assert.equal(
      sheetContentHash({
        ...sheet,
        rows: sheet.rows.map((row) =>
          row.kind === "FREE" ? { ...row, source: "CALENDAR" as const } : row,
        ),
      }),
      base,
    );
  });

  it("changes when a printed cell or a total changes", () => {
    const base = sheetContentHash(sheet);
    const rows = sheet.rows.map((row) =>
      row.date === "2026-11-16" ? { ...row, end: "17:00", minutes: 600 } : row,
    );
    assert.notEqual(
      sheetContentHash({
        ...sheet,
        rows,
        totalMinutes: sheet.totalMinutes + 60,
      }),
      base,
    );
    assert.notEqual(sheetContentHash({ ...sheet, sickDays: 1 }), base);
    assert.notEqual(sheetContentHash({ ...sheet, swapsDecree: null }), base);
  });

  it("keeps a past month's hash as time passes, so a signed month does not turn changed by itself", () => {
    const october = (iso: string) =>
      sheetContentHash(
        attendanceSheet({
          month: "2026-10",
          schedules: [
            {
              validFrom: "2026-10-01",
              days: [1, 2, 3, 4, 5].map((weekday) => ({
                weekday,
                start: "07:00",
                end: "16:00",
              })),
              updatedAt: "2026-10-01T08:00:00.000Z",
            },
          ],
          entries: [],
          now: new Date(iso),
        }),
      );
    assert.equal(
      october("2026-11-01T10:00:00.000Z"),
      october("2027-08-15T10:00:00.000Z"),
    );
    // the current month does change as its days pass: that is a real change of the printed page
    const november = (iso: string) =>
      sheetContentHash(
        attendanceSheet({
          month: "2026-11",
          schedules: [],
          entries: [],
          now: new Date(iso),
        }),
      );
    assert.equal(
      november("2026-11-13T10:00:00.000Z"),
      november("2026-11-13T10:30:00.000Z"),
    );
  });

  it("says whether the employee set an entry themselves, only where the author was read", () => {
    const row = {
      date: dateOnly("2026-11-20"),
      kind: "LEAVE" as const,
      startMinute: null,
      endMinute: null,
      updatedAt: new Date("2026-11-13T09:00:00.000Z"),
    };
    assert.equal(
      dayView({ ...row, updatedById: "u-1" }, "u-1").setByEmployee,
      true,
    );
    assert.equal(
      dayView({ ...row, updatedById: "admin-1" }, "u-1").setByEmployee,
      false,
    );
    assert.equal(
      dayView({ ...row, updatedById: null }, "u-1").setByEmployee,
      false,
    );
    assert.equal("setByEmployee" in dayView(row, "u-1"), false);
    assert.equal(
      "setByEmployee" in dayView({ ...row, updatedById: "u-1" }),
      false,
    );
  });
});
