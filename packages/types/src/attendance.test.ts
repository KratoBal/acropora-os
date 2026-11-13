import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ATTENDANCE_SELF_TAKEN,
  attendanceDayProblem,
  attendanceSelfMarkProblem,
  attendanceRangeProblem,
  attendanceWeekProblem,
  formatAttendanceClock,
  isAttendanceDate,
  isAttendanceEmployeeRole,
  parseAttendanceClock,
} from "./attendance.js";
import { PERMISSIONS, ROLE_PERMISSIONS, USER_ROLES } from "./auth.js";

/*
  WHAT TURNS THIS RED. A time that is not a time of day accepted ("7:30", "24:00", "12:60"), or a departure at or before the
  arrival; a weekday outside 1..7 or twice in one week; a WORKED day without both times, or a mark (sick, leave, day off)
  carrying a time the sheet would never print; a non-day ("2026-02-30") taken as a date; a partner or machine account counted
  as an employee; the attendance right reaching a role other than OWNER and ADMIN (a sick day is health data).
*/
describe("attendance times", () => {
  it("reads and writes HH:MM as minutes after midnight", () => {
    assert.equal(parseAttendanceClock("07:30"), 450);
    assert.equal(parseAttendanceClock("00:00"), 0);
    assert.equal(parseAttendanceClock("23:59"), 1439);
    assert.equal(formatAttendanceClock(450), "07:30");
    assert.equal(formatAttendanceClock(960), "16:00");
    for (const wrong of ["7:30", "24:00", "12:60", "", "07:30:00", "ab:cd"])
      assert.equal(parseAttendanceClock(wrong), null, wrong);
  });

  it("refuses a departure at or before the arrival", () => {
    assert.equal(attendanceRangeProblem("07:00", "16:00"), null);
    assert.match(attendanceRangeProblem("16:00", "16:00")!, /után/);
    assert.match(attendanceRangeProblem("16:00", "07:00")!, /után/);
    assert.match(attendanceRangeProblem("7:00", "16:00")!, /érkezés/);
    assert.match(attendanceRangeProblem("07:00", "25:00")!, /távozás/);
  });

  it("takes only real calendar days", () => {
    assert.equal(isAttendanceDate("2026-11-13"), true);
    assert.equal(isAttendanceDate("2028-02-29"), true);
    for (const wrong of ["2026-02-30", "2026-13-01", "2026-11-1", "13.11.2026"])
      assert.equal(isAttendanceDate(wrong), false, wrong);
  });
});

describe("a weekly schedule", () => {
  it("is a set of distinct weekdays 1..7, each with a valid range", () => {
    assert.equal(attendanceWeekProblem([]), null);
    assert.equal(
      attendanceWeekProblem([
        { weekday: 1, start: "07:00", end: "16:00" },
        { weekday: 6, start: "09:00", end: "13:00" },
      ]),
      null,
    );
    assert.match(
      attendanceWeekProblem([{ weekday: 0, start: "07:00", end: "16:00" }])!,
      /Ismeretlen nap/,
    );
    assert.match(
      attendanceWeekProblem([{ weekday: 8, start: "07:00", end: "16:00" }])!,
      /Ismeretlen nap/,
    );
    assert.match(
      attendanceWeekProblem([
        { weekday: 2, start: "07:00", end: "16:00" },
        { weekday: 2, start: "08:00", end: "12:00" },
      ])!,
      /kétszer/,
    );
    assert.match(
      attendanceWeekProblem([{ weekday: 3, start: "16:00", end: "07:00" }])!,
      /után/,
    );
  });
});

describe("a day entry", () => {
  it("needs both times on a WORKED day", () => {
    assert.equal(
      attendanceDayProblem({ kind: "WORKED", start: "07:00", end: "18:00" }),
      null,
    );
    assert.match(
      attendanceDayProblem({ kind: "WORKED", start: "07:00" })!,
      /érkezést és a távozást/,
    );
    assert.match(
      attendanceDayProblem({ kind: "WORKED", start: "18:00", end: "07:00" })!,
      /után/,
    );
  });

  it("carries no time on a mark", () => {
    for (const kind of ["SICK", "LEAVE", "DAY_OFF"] as const) {
      assert.equal(attendanceDayProblem({ kind }), null, kind);
      assert.equal(
        attendanceDayProblem({ kind, start: null, end: null }),
        null,
        kind,
      );
      assert.match(
        attendanceDayProblem({ kind, start: "07:00", end: "16:00" })!,
        /nem tartozik időpont/,
        kind,
      );
    }
    assert.match(
      attendanceDayProblem({ kind: "OVERTIME" as never })!,
      /Ismeretlen/,
    );
  });
});

describe("who has a sheet, and who keeps it", () => {
  it("is our own human colleagues, not partner or machine accounts", () => {
    assert.deepEqual(USER_ROLES.filter(isAttendanceEmployeeRole), [
      "OWNER",
      "ADMIN",
      "MANAGER",
      "SALES",
      "WAREHOUSE",
      "SERVICE",
      "VIEWER",
    ]);
  });

  it("is kept by OWNER and ADMIN only", () => {
    assert.deepEqual(
      USER_ROLES.filter((role) =>
        ROLE_PERMISSIONS[role].includes(PERMISSIONS.ATTENDANCE_MANAGE),
      ),
      ["OWNER", "ADMIN"],
    );
  });
});

describe("an employee's own marks (S3)", () => {
  const today = "2026-11-13";

  it("allows leave and day off from tomorrow, over nothing or over an own mark", () => {
    for (const kind of ["LEAVE", "DAY_OFF"] as const)
      for (const existing of [null, "LEAVE", "DAY_OFF"] as const)
        assert.equal(
          attendanceSelfMarkProblem({
            kind,
            date: "2026-11-14",
            today,
            existing,
          }),
          null,
          `${kind} over ${existing}`,
        );
    assert.equal(
      attendanceSelfMarkProblem({
        date: "2026-12-24",
        today,
        existing: "LEAVE",
      }),
      null,
    );
  });

  it("refuses another kind, today, the past, a bad date, and an admin's other mark", () => {
    for (const kind of ["SICK", "WORKED"] as const)
      assert.match(
        attendanceSelfMarkProblem({
          kind,
          date: "2026-11-14",
          today,
          existing: null,
        })!,
        /csak szabadságot vagy szabadnapot/,
      );
    for (const date of ["2026-11-13", "2026-11-12"])
      assert.match(
        attendanceSelfMarkProblem({
          kind: "LEAVE",
          date,
          today,
          existing: null,
        })!,
        /holnapi vagy egy későbbi/,
        date,
      );
    assert.match(
      attendanceSelfMarkProblem({
        kind: "LEAVE",
        date: "2026-02-30",
        today,
        existing: null,
      })!,
      /Nem érvényes dátum/,
    );
    for (const existing of ["SICK", "WORKED"] as const)
      assert.equal(
        attendanceSelfMarkProblem({
          kind: "LEAVE",
          date: "2026-11-14",
          today,
          existing,
        }),
        ATTENDANCE_SELF_TAKEN,
        existing,
      );
  });
});
