import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AttendanceDayEntry, AttendanceSchedule } from "./attendance.js";
import {
  attendanceClock,
  attendanceSheet,
  isoWeekday,
  monthDays,
  scheduleOn,
} from "./attendance-sheet.js";
import {
  easterSunday,
  hungarianCalendarDay,
  hungarianPublicHolidays,
} from "./hungarian-work-calendar.js";

/*
  WHAT TURNS THIS RED. A wrong Easter (and so a wrong Good Friday, Easter Monday or Whit Monday); 24 December taken as a
  public holiday (in 2026 it is a swapped rest day, which it could not be if it were one); a 2026 swap missing or reversed;
  a swapped Saturday worked by its own weekday's schedule instead of the day it stands in for; a schedule change applied to
  days before its start (a signed month rewritten); an entry losing to the calendar or the schedule (a worked holiday not
  counted); a lunch break deducted (7 to 16 is 9 hours); a day without any schedule printed as free; a year without its
  decree printed as an ordinary year without saying so.
*/
/** A clock after every month these tests compute: they see complete months (the "as of now" rule has its own tests). */
const LATER = new Date("2030-01-01T12:00:00.000Z");

const weekdays = (start: string, end: string, from = 1, to = 5) =>
  Array.from({ length: to - from + 1 }, (_, i) => ({
    weekday: from + i,
    start,
    end,
  }));
const version = (
  validFrom: string,
  days: AttendanceSchedule["days"],
): AttendanceSchedule => ({
  validFrom,
  days,
  updatedAt: "2026-11-13T09:00:00.000Z",
});
const entry = (
  date: string,
  kind: AttendanceDayEntry["kind"],
  start: string | null = null,
  end: string | null = null,
): AttendanceDayEntry => ({
  date,
  kind,
  start,
  end,
  updatedAt: "2026-11-13T09:00:00.000Z",
});

describe("the Hungarian work calendar", () => {
  it("computes Easter", () => {
    assert.equal(easterSunday(2019), "2019-04-21");
    assert.equal(easterSunday(2024), "2024-03-31");
    assert.equal(easterSunday(2025), "2025-04-20");
    assert.equal(easterSunday(2026), "2026-04-05");
    assert.equal(easterSunday(2027), "2027-03-28");
    assert.equal(easterSunday(2038), "2038-04-25");
  });

  it("lists the 11 holidays of 102. § (1) and the two Sundays of (4), the movable ones from Easter", () => {
    const days = hungarianPublicHolidays(2026);
    assert.deepEqual([...days.keys()].sort(), [
      "2026-01-01",
      "2026-03-15",
      "2026-04-03",
      "2026-04-05",
      "2026-04-06",
      "2026-05-01",
      "2026-05-24",
      "2026-05-25",
      "2026-08-20",
      "2026-10-23",
      "2026-11-01",
      "2026-12-25",
      "2026-12-26",
    ]);
    assert.equal(days.get("2026-04-03"), "Nagypéntek");
    assert.equal(days.get("2026-05-25"), "Pünkösdhétfő");
  });

  it("knows the 2026 decree's swaps, and that 24 December is one of them", () => {
    assert.deepEqual(hungarianCalendarDay("2026-12-24"), {
      kind: "SWAPPED_REST",
    });
    assert.deepEqual(hungarianCalendarDay("2026-12-12"), {
      kind: "SWAPPED_WORK",
      standsFor: "2026-12-24",
    });
    assert.deepEqual(hungarianCalendarDay("2026-01-02"), {
      kind: "SWAPPED_REST",
    });
    assert.deepEqual(hungarianCalendarDay("2026-01-10"), {
      kind: "SWAPPED_WORK",
      standsFor: "2026-01-02",
    });
    assert.deepEqual(hungarianCalendarDay("2026-08-21"), {
      kind: "SWAPPED_REST",
    });
    assert.deepEqual(hungarianCalendarDay("2026-08-08"), {
      kind: "SWAPPED_WORK",
      standsFor: "2026-08-21",
    });
    assert.deepEqual(hungarianCalendarDay("2026-11-13"), { kind: "ORDINARY" });
    assert.deepEqual(hungarianCalendarDay("2026-11-01"), {
      kind: "HOLIDAY",
      name: "Mindenszentek",
    });
  });
});

describe("the month's days", () => {
  it("covers the month, leap February too, with ISO weekdays", () => {
    assert.equal(monthDays("2026-11").length, 30);
    assert.equal(monthDays("2028-02").length, 29);
    assert.equal(monthDays("2026-02").at(-1), "2026-02-28");
    assert.equal(isoWeekday("2026-11-01"), 7);
    assert.equal(isoWeekday("2026-11-02"), 1);
  });

  it("takes the latest version not after the day", () => {
    const versions = [
      version("2026-11-16", []),
      version("2026-01-01", []),
      version("2026-12-01", []),
    ];
    assert.equal(scheduleOn(versions, "2025-12-31"), null);
    assert.equal(scheduleOn(versions, "2026-11-15")?.validFrom, "2026-01-01");
    assert.equal(scheduleOn(versions, "2026-11-16")?.validFrom, "2026-11-16");
    assert.equal(scheduleOn(versions, "2026-12-31")?.validFrom, "2026-12-01");
  });
});

describe("the monthly sheet", () => {
  it("fills a month from the schedule, full time without a break, the entries over it", () => {
    const sheet = attendanceSheet({
      now: LATER,
      month: "2026-11",
      schedules: [version("2026-10-01", weekdays("07:00", "16:00"))],
      entries: [
        entry("2026-11-13", "SICK"),
        entry("2026-11-20", "LEAVE"),
        entry("2026-11-21", "WORKED", "09:00", "13:00"),
        entry("2026-11-23", "DAY_OFF"),
      ],
    });
    const row = (date: string) => sheet.rows.find((r) => r.date === date)!;
    assert.equal(sheet.rows.length, 30);
    assert.deepEqual(
      [
        row("2026-11-02").start,
        row("2026-11-02").end,
        row("2026-11-02").minutes,
      ],
      ["07:00", "16:00", 540],
    );
    assert.equal(row("2026-11-01").kind, "HOLIDAY");
    assert.equal(row("2026-11-01").holiday, "Mindenszentek");
    assert.equal(row("2026-11-07").kind, "FREE");
    assert.deepEqual(
      [
        row("2026-11-13").kind,
        row("2026-11-13").mark,
        row("2026-11-13").minutes,
      ],
      ["SICK", "B", 0],
    );
    assert.equal(row("2026-11-20").mark, "SZ");
    assert.deepEqual(
      [
        row("2026-11-21").kind,
        row("2026-11-21").source,
        row("2026-11-21").minutes,
      ],
      ["WORK", "ENTRY", 240],
    );
    assert.deepEqual(
      [row("2026-11-23").kind, row("2026-11-23").mark],
      ["DAY_OFF", null],
    );
    // 21 weekdays, three of them marked, plus a 4-hour Saturday
    assert.equal(sheet.totalMinutes, 18 * 540 + 240);
    assert.equal(sheet.sickDays, 1);
    assert.equal(sheet.leaveDays, 1);
    assert.equal(sheet.swapsDecree, "10/2025. (IV. 30.) NGM rendelet");
  });

  it("applies a schedule change from its day only", () => {
    const sheet = attendanceSheet({
      now: LATER,
      month: "2026-11",
      schedules: [
        version("2026-10-01", weekdays("07:00", "16:00")),
        version("2026-11-16", weekdays("08:00", "16:00")),
      ],
      entries: [],
    });
    const row = (date: string) => sheet.rows.find((r) => r.date === date)!;
    assert.equal(row("2026-11-13").start, "07:00");
    assert.equal(row("2026-11-16").start, "08:00");
    assert.equal(sheet.totalMinutes, 10 * 540 + 11 * 480);
  });

  it("rests on the decree's rest day and works the swapped Saturday by the day it stands for", () => {
    const sheet = attendanceSheet({
      now: LATER,
      month: "2026-12",
      // Thursday is a shorter day, so the swapped Saturday shows whose schedule it took
      schedules: [
        version("2026-10-01", [
          ...weekdays("07:00", "16:00", 1, 3),
          { weekday: 4, start: "08:00", end: "12:00" },
          { weekday: 5, start: "07:00", end: "16:00" },
        ]),
      ],
      entries: [],
    });
    const row = (date: string) => sheet.rows.find((r) => r.date === date)!;
    assert.deepEqual(
      [row("2026-12-12").kind, row("2026-12-12").start, row("2026-12-12").end],
      ["WORK", "08:00", "12:00"],
    );
    assert.equal(row("2026-12-24").kind, "SWAPPED_REST");
    assert.equal(row("2026-12-25").kind, "HOLIDAY");
    assert.equal(row("2026-12-26").kind, "HOLIDAY");
    assert.equal(row("2026-12-19").kind, "FREE");
  });

  it("counts a worked holiday, and says when no schedule is in force", () => {
    const sheet = attendanceSheet({
      now: LATER,
      month: "2026-10",
      schedules: [version("2026-10-15", weekdays("07:00", "16:00"))],
      entries: [entry("2026-10-23", "WORKED", "10:00", "14:00")],
    });
    const row = (date: string) => sheet.rows.find((r) => r.date === date)!;
    assert.deepEqual(
      [row("2026-10-23").kind, row("2026-10-23").minutes],
      ["WORK", 240],
    );
    assert.equal(row("2026-10-14").kind, "NO_SCHEDULE");
    assert.equal(row("2026-10-14").source, "NONE");
    assert.equal(row("2026-10-15").kind, "WORK");
  });

  it("names no decree for a year that is not in the table", () => {
    const sheet = attendanceSheet({
      now: LATER,
      month: "2027-01",
      schedules: [],
      entries: [],
    });
    assert.equal(sheet.swapsDecree, null);
    assert.equal(sheet.rows[0]!.kind, "HOLIDAY");
    assert.throws(() =>
      attendanceSheet({
        now: LATER,
        month: "2027-13",
        schedules: [],
        entries: [],
      }),
    );
  });
});

describe("the sheet as of now (Balázs on stage, 2026-11-13: never filled ahead)", () => {
  const schedules = [version("2026-10-01", weekdays("08:00", "16:00"))];
  // November is CET (UTC+1): 08:00 in Budapest is 07:00 UTC
  const at = (iso: string) =>
    attendanceSheet({
      month: "2026-11",
      schedules,
      entries: [],
      now: new Date(iso),
    });
  const row = (sheet: ReturnType<typeof at>, date: string) =>
    sheet.rows.find((r) => r.date === date)!;

  it("reads the Budapest day and minute", () => {
    assert.deepEqual(attendanceClock(new Date("2026-11-13T06:59:00.000Z")), {
      today: "2026-11-13",
      minute: 7 * 60 + 59,
    });
    assert.deepEqual(attendanceClock(new Date("2026-11-12T23:30:00.000Z")), {
      today: "2026-11-13",
      minute: 30,
    });
  });

  it("before today's arrival: today and every later day empty, the earlier days full", () => {
    const sheet = at("2026-11-13T06:59:00.000Z");
    assert.deepEqual(
      [
        row(sheet, "2026-11-13").start,
        row(sheet, "2026-11-13").end,
        row(sheet, "2026-11-13").minutes,
      ],
      [null, null, 0],
    );
    assert.equal(row(sheet, "2026-11-13").future, false);
    assert.deepEqual(
      [
        row(sheet, "2026-11-16").start,
        row(sheet, "2026-11-16").minutes,
        row(sheet, "2026-11-16").future,
      ],
      [null, 0, true],
    );
    assert.equal(row(sheet, "2026-11-12").end, "16:00");
    // 2..12 November: 9 working days of 8 hours
    assert.equal(sheet.totalMinutes, 9 * 480);
  });

  it("between arrival and departure: the arrival shows, no departure, no minutes yet", () => {
    const sheet = at("2026-11-13T10:00:00.000Z");
    assert.deepEqual(
      [
        row(sheet, "2026-11-13").start,
        row(sheet, "2026-11-13").end,
        row(sheet, "2026-11-13").minutes,
      ],
      ["08:00", null, 0],
    );
    assert.equal(sheet.totalMinutes, 9 * 480);
  });

  it("from the departure on: the whole day counts", () => {
    for (const iso of [
      "2026-11-13T15:00:00.000Z",
      "2026-11-13T22:00:00.000Z",
    ]) {
      const sheet = at(iso);
      assert.deepEqual(
        [
          row(sheet, "2026-11-13").start,
          row(sheet, "2026-11-13").end,
          row(sheet, "2026-11-13").minutes,
        ],
        ["08:00", "16:00", 480],
        iso,
      );
      assert.equal(sheet.totalMinutes, 10 * 480, iso);
    }
  });

  it("on the month's last day, after the departure, the month is complete", () => {
    const sheet = at("2026-11-30T16:00:00.000Z");
    assert.equal(sheet.rows.filter((r) => r.future).length, 0);
    assert.equal(sheet.totalMinutes, 21 * 480);
  });

  it("a later month is empty, a past month complete, whatever the clock", () => {
    const ahead = attendanceSheet({
      month: "2026-12",
      schedules,
      entries: [entry("2026-12-07", "LEAVE"), entry("2026-12-08", "SICK")],
      now: new Date("2026-11-13T12:00:00.000Z"),
    });
    assert.ok(
      ahead.rows.every((r) => r.future && r.start === null && r.mark === null),
    );
    assert.deepEqual(
      [ahead.totalMinutes, ahead.sickDays, ahead.leaveDays],
      [0, 0, 0],
    );
    // the planned leave keeps its kind for the employee's own input screen
    assert.equal(
      ahead.rows.find((r) => r.date === "2026-12-07")!.kind,
      "LEAVE",
    );

    const october = (iso: string) =>
      attendanceSheet({
        month: "2026-10",
        schedules,
        entries: [],
        now: new Date(iso),
      });
    assert.deepEqual(
      october("2026-11-13T12:00:00.000Z"),
      october("2027-06-01T12:00:00.000Z"),
    );
    // 22 weekdays, 23 October (a Friday) is a holiday: 21 working days
    assert.equal(october("2026-11-13T12:00:00.000Z").totalMinutes, 21 * 480);
  });

  it("counts a future mark in no total", () => {
    const sheet = attendanceSheet({
      month: "2026-11",
      schedules,
      entries: [
        entry("2026-11-05", "LEAVE"),
        entry("2026-11-20", "LEAVE"),
        entry("2026-11-24", "SICK"),
      ],
      now: new Date("2026-11-13T12:00:00.000Z"),
    });
    assert.deepEqual([sheet.leaveDays, sheet.sickDays], [1, 0]);
    assert.equal(sheet.rows.find((r) => r.date === "2026-11-05")!.mark, "SZ");
    assert.equal(sheet.rows.find((r) => r.date === "2026-11-20")!.mark, null);
  });

  it("leaves holidays and swapped days as they were, on the days already past", () => {
    const december = attendanceSheet({
      month: "2026-12",
      schedules,
      entries: [],
      now: new Date("2026-12-31T20:00:00.000Z"),
    });
    assert.equal(
      december.rows.find((r) => r.date === "2026-12-24")!.kind,
      "SWAPPED_REST",
    );
    assert.equal(
      december.rows.find((r) => r.date === "2026-12-25")!.kind,
      "HOLIDAY",
    );
    assert.equal(
      december.rows.find((r) => r.date === "2026-12-12")!.start,
      "08:00",
    );
  });

  it("says which entries the employee set themselves (S3, barracuda on #2516)", () => {
    const sheet = attendanceSheet({
      month: "2026-11",
      schedules,
      entries: [
        { ...entry("2026-11-20", "LEAVE"), setByEmployee: true },
        { ...entry("2026-11-23", "LEAVE"), setByEmployee: false },
        entry("2026-11-24", "DAY_OFF"),
      ],
      now: new Date("2026-11-13T12:00:00.000Z"),
    });
    const own = (date: string) =>
      sheet.rows.find((r) => r.date === date)!.ownEntry;
    assert.deepEqual(
      [
        own("2026-11-20"),
        own("2026-11-23"),
        own("2026-11-24"),
        own("2026-11-16"),
      ],
      [true, false, false, false],
    );
  });
});
