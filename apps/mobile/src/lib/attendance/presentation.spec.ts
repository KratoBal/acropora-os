import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  budapestToday,
  canMarkOwnDay,
  dayLabel,
  formatHours,
  hasAttendanceSheet,
  monthLabel,
  ownMark,
  rowNote,
  rowTimes,
  shiftMonth,
  type AttendanceSheetRow,
} from "./presentation";

/*
  WHAT TURNS THIS RED. "Today" taken from the device's zone instead of Budapest's (after 23:00 UTC in winter the day is
  already the next one); a month step that breaks over the year's end; a mark not in place of the times; a day offered
  for the employee's own mark that is today, in the past, or carries the admin's other mark; the copied list of roles
  without a sheet drifting from the server's machine and partner roles.
*/
const row = (patch: Partial<AttendanceSheetRow>): AttendanceSheetRow => ({
  date: "2026-11-16",
  weekday: 1,
  kind: "WORK",
  start: "07:00",
  end: "16:00",
  minutes: 540,
  mark: null,
  source: "SCHEDULE",
  holiday: null,
  ...patch,
});

describe("the phone's attendance sheet", () => {
  it("takes today as the Budapest day", () => {
    assert.equal(
      budapestToday(new Date("2026-11-12T23:30:00.000Z")),
      "2026-11-13",
    );
    assert.equal(
      budapestToday(new Date("2026-11-12T22:30:00.000Z")),
      "2026-11-12",
    );
  });

  it("steps months over the year's end, and names them in Hungarian", () => {
    assert.equal(shiftMonth("2026-12", 1), "2027-01");
    assert.equal(shiftMonth("2026-01", -1), "2025-12");
    assert.equal(shiftMonth("2026-11", 0), "2026-11");
    assert.equal(monthLabel("2026-11"), "2026. november");
  });

  it("shows times, marks and hours as on the paper sheet", () => {
    assert.equal(dayLabel(row({})), "11. 16. H");
    assert.equal(rowTimes(row({})), "07:00-16:00");
    assert.equal(formatHours(540), "9:00");
    assert.equal(
      rowTimes(
        row({
          kind: "SICK",
          start: null,
          end: null,
          mark: "B",
          source: "ENTRY",
        }),
      ),
      "B",
    );
    assert.equal(
      rowNote(
        row({ kind: "HOLIDAY", holiday: "Karácsony", start: null, end: null }),
      ),
      "Karácsony",
    );
    assert.equal(
      rowNote(row({ kind: "WORK", source: "ENTRY" })),
      "Eltérő munkaidő",
    );
  });

  it("offers only future days without the admin's other mark", () => {
    const today = "2026-11-13";
    assert.equal(canMarkOwnDay(row({ date: "2026-11-14" }), today), true);
    assert.equal(canMarkOwnDay(row({ date: "2026-11-13" }), today), false);
    assert.equal(canMarkOwnDay(row({ date: "2026-11-12" }), today), false);
    for (const kind of ["LEAVE", "DAY_OFF"] as const) {
      const own = row({
        date: "2026-11-20",
        kind,
        source: "ENTRY",
        start: null,
        end: null,
      });
      assert.equal(canMarkOwnDay(own, today), true, kind);
      assert.equal(ownMark(own), kind);
    }
    for (const kind of ["SICK", "WORK"] as const)
      assert.equal(
        canMarkOwnDay(
          row({ date: "2026-11-20", kind, source: "ENTRY" }),
          today,
        ),
        false,
        kind,
      );
  });

  it("keeps the roles without a sheet in step with the server's machine and partner roles", () => {
    const source = readFileSync("../../packages/types/src/auth.ts", "utf8");
    const list = (name: string) => {
      const match = new RegExp(
        `export const ${name}[^=]*= \\[([^\\]]*)\\]`,
      ).exec(source);
      assert.ok(match, `${name} not found in packages/types/src/auth.ts`);
      return [...match[1]!.matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]!);
    };
    const without = [...list("MACHINE_ROLES"), ...list("PARTNER_ROLES")];
    assert.ok(without.length >= 4);
    for (const role of without)
      assert.equal(hasAttendanceSheet(role), false, role);
    for (const role of [
      "OWNER",
      "ADMIN",
      "MANAGER",
      "SALES",
      "WAREHOUSE",
      "SERVICE",
      "VIEWER",
    ])
      assert.equal(hasAttendanceSheet(role), true, role);
  });
});
