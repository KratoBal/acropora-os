import { createHash } from "node:crypto";

import {
  formatAttendanceClock,
  type AttendanceSheet,
  type AttendanceDayEntry,
  type AttendanceDayKind,
  type AttendanceSchedule,
  type AttendanceScheduleDay,
} from "@acropora/types";

import { hours, rowCells } from "./attendance-sheet-document.js";

/**
 * THE ATTENDANCE ROWS AND WHAT THE AUDIT LOG SAYS ABOUT THEM (os-jelenleti-iv, S1). Pure, so the shapes and the "did anything
 * change" rule are measured without a database; the repository only stores what these return.
 */
export interface ScheduleDayRow {
  weekday: number;
  startMinute: number;
  endMinute: number;
}

export interface ScheduleRow {
  validFrom: Date;
  updatedAt: Date;
  days: ScheduleDayRow[];
}

export interface DayRow {
  date: Date;
  kind: AttendanceDayKind;
  startMinute: number | null;
  endMinute: number | null;
  updatedAt: Date;
}

/** "2026-11-13" as the `@db.Date` value Prisma stores (UTC midnight: a date column has no zone). */
export const dateOnly = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

/** The `@db.Date` value back as "2026-11-13". */
export const dateKey = (date: Date): string => date.toISOString().slice(0, 10);

const weekOf = (days: readonly ScheduleDayRow[]): AttendanceScheduleDay[] =>
  [...days]
    .sort((a, b) => a.weekday - b.weekday)
    .map((day) => ({
      weekday: day.weekday,
      start: formatAttendanceClock(day.startMinute),
      end: formatAttendanceClock(day.endMinute),
    }));

export function scheduleView(row: ScheduleRow): AttendanceSchedule {
  return {
    validFrom: dateKey(row.validFrom),
    days: weekOf(row.days),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function dayView(row: DayRow): AttendanceDayEntry {
  return {
    date: dateKey(row.date),
    kind: row.kind,
    start:
      row.startMinute === null ? null : formatAttendanceClock(row.startMinute),
    end: row.endMinute === null ? null : formatAttendanceClock(row.endMinute),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * THE AUDIT VALUES: readable times, not minutes, because the log is read by a person asking "what did this day say before".
 * `null` is "no row": a week that did not exist yet, or a day that followed the schedule.
 */
export type WeekAuditValue = { weekday: number; start: string; end: string }[];
export type DayAuditValue = {
  kind: AttendanceDayKind;
  start: string | null;
  end: string | null;
};

export const weekAuditValue = (
  days: readonly ScheduleDayRow[] | null,
): WeekAuditValue | null => (days ? weekOf(days) : null);

export const dayAuditValue = (
  row: Pick<DayRow, "kind" | "startMinute" | "endMinute"> | null,
): DayAuditValue | null =>
  row
    ? {
        kind: row.kind,
        start:
          row.startMinute === null
            ? null
            : formatAttendanceClock(row.startMinute),
        end:
          row.endMinute === null ? null : formatAttendanceClock(row.endMinute),
      }
    : null;

/** Equal audit values: nothing to write, and nothing to log (a save without a change must not look like one). */
export const sameAuditValue = (
  a: WeekAuditValue | DayAuditValue | null,
  b: WeekAuditValue | DayAuditValue | null,
): boolean => JSON.stringify(a) === JSON.stringify(b);

export const ATTENDANCE_AUDIT_ACTIONS = {
  schedule: "attendance.schedule-changed",
  day: "attendance.day-changed",
  /** S2d: a month printed for signature; the PDF itself is kept in AttendanceSignedSheet. */
  printed: "attendance.sheet-printed-for-signature",
} as const;

/**
 * THE CONTENT OF A SHEET, as a hash (S2d): WHAT THE PAGE PRINTS, as a versioned extract (barracuda on #2513). Every row's
 * printed cells (date, arrival or mark, departure or mark, hours, note), the totals, and whether the year's swapped days
 * were known. Not the internal row object: a later change to its shape or to a field the page does not print must not
 * flip every signed month to "changed" at once. A change to what the page prints is a change, and that is what it is for.
 *
 * NOT IN IT, on purpose: the print time, and the employee's name. A later name change does not make a signed month
 * "changed"; the kept PDF shows the name it was signed under. If the printed extract itself ever changes, raise `v`: the
 * kept copies then all read as changed, which is the safe direction, and the reason is written here.
 */
export function sheetContentHash(sheet: AttendanceSheet): string {
  const printed = {
    v: 1,
    month: sheet.month,
    rows: sheet.rows.map(rowCells),
    totals: [hours(sheet.totalMinutes), sheet.sickDays, sheet.leaveDays],
    swapsKnown: sheet.swapsDecree !== null,
  };
  return createHash("sha256").update(JSON.stringify(printed)).digest("hex");
}
