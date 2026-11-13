import {
  parseAttendanceClock,
  type AttendanceDayEntry,
  type AttendanceSchedule,
} from "./attendance.js";
import {
  HUNGARIAN_WORKDAY_SWAPS,
  addDays,
  hungarianCalendarDay,
} from "./hungarian-work-calendar.js";

/**
 * THE MONTHLY ATTENDANCE SHEET, computed (os-jelenleti-iv, S2a). Pure and auth-free: the API serves it, the screen and the
 * PDF print it, and a later public use would compute the same rows.
 *
 * A DAY IS DECIDED IN THIS ORDER, and the first that applies wins:
 *   1. the day's entry (an admin or the employee marked it: sick, leave, day off, or other times), so a worked holiday or
 *      an extra Saturday is recorded as worked;
 *   2. a public holiday;
 *   3. a swapped rest day of the year's decree;
 *   4. the schedule version in force that day (the latest `validFrom` not after it); on a swapped working Saturday, the
 *      schedule of the weekday it stands in for;
 *   5. no version in force: the day says so, nothing is invented.
 *
 * Hours worked are the full time from arrival to departure, no break deducted (Balázs 2026-11-13 07:59 UTC: 7 to 16 is 9
 * hours).
 */
export const ATTENDANCE_SHEET_ROW_KINDS = [
  "WORK",
  "SICK",
  "LEAVE",
  "DAY_OFF",
  "HOLIDAY",
  "SWAPPED_REST",
  "FREE",
  "NO_SCHEDULE",
] as const;
export type AttendanceSheetRowKind =
  (typeof ATTENDANCE_SHEET_ROW_KINDS)[number];

export interface AttendanceSheetRow {
  /** "YYYY-MM-DD". */
  date: string;
  /** ISO weekday, 1 Monday ... 7 Sunday. */
  weekday: number;
  kind: AttendanceSheetRowKind;
  /** Arrival and departure on a WORK row, "HH:MM"; null otherwise. */
  start: string | null;
  end: string | null;
  /** Minutes worked; 0 on every row but WORK. */
  minutes: number;
  /** What the sheet prints in place of the times: "B" sick, "SZ" leave (Luca's paper format); null otherwise. */
  mark: "B" | "SZ" | null;
  /** Where the row comes from: the day's own entry, the schedule, or the calendar. */
  source: "ENTRY" | "SCHEDULE" | "CALENDAR" | "NONE";
  /** The holiday's name on a HOLIDAY row. */
  holiday: string | null;
}

export interface AttendanceSheet {
  /** "YYYY-MM". */
  month: string;
  rows: AttendanceSheetRow[];
  totalMinutes: number;
  sickDays: number;
  leaveDays: number;
  /**
   * The decree that set this year's swapped days, or null when the year is not in the table yet: then the sheet cannot
   * know the bridge days, and the screen and the PDF must say so rather than print an ordinary week.
   */
  swapsDecree: string | null;
}

/**
 * The latest copy of the month printed for signature (S2d), and whether the month changed since: then the signed copy
 * differs and needs a new print and signature (brief point 8). Null when the month was never printed for signature.
 */
export interface AttendanceSignedCopy {
  id: string;
  printedAt: string;
  differs: boolean;
}

/** The sheet as the API serves it. */
export interface AttendanceSheetResponse extends AttendanceSheet {
  userId: string;
  signedCopy: AttendanceSignedCopy | null;
}

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

export const isAttendanceMonth = (value: string): boolean => MONTH.test(value);

/** ISO weekday of an ISO day. */
export const isoWeekday = (day: string): number => {
  const sunday0 = new Date(`${day}T00:00:00.000Z`).getUTCDay();
  return sunday0 === 0 ? 7 : sunday0;
};

/** The days of a month, first to last. */
export function monthDays(month: string): string[] {
  const days: string[] = [];
  for (let day = `${month}-01`; day.startsWith(month); day = addDays(day, 1))
    days.push(day);
  return days;
}

/** The version in force on a day: the latest `validFrom` not after it. */
export function scheduleOn(
  schedules: readonly AttendanceSchedule[],
  day: string,
): AttendanceSchedule | null {
  let found: AttendanceSchedule | null = null;
  for (const schedule of schedules)
    if (
      schedule.validFrom <= day &&
      (!found || schedule.validFrom > found.validFrom)
    )
      found = schedule;
  return found;
}

const span = (start: string, end: string) =>
  parseAttendanceClock(end)! - parseAttendanceClock(start)!;

const blank = (
  date: string,
  kind: AttendanceSheetRowKind,
  source: AttendanceSheetRow["source"],
): AttendanceSheetRow => ({
  date,
  weekday: isoWeekday(date),
  kind,
  start: null,
  end: null,
  minutes: 0,
  mark: null,
  source,
  holiday: null,
});

function rowOf(
  date: string,
  entry: AttendanceDayEntry | undefined,
  schedules: readonly AttendanceSchedule[],
): AttendanceSheetRow {
  if (entry) {
    if (entry.kind === "WORKED" && entry.start && entry.end)
      return {
        ...blank(date, "WORK", "ENTRY"),
        start: entry.start,
        end: entry.end,
        minutes: span(entry.start, entry.end),
      };
    if (entry.kind === "SICK")
      return { ...blank(date, "SICK", "ENTRY"), mark: "B" };
    if (entry.kind === "LEAVE")
      return { ...blank(date, "LEAVE", "ENTRY"), mark: "SZ" };
    return blank(date, "DAY_OFF", "ENTRY");
  }

  const calendar = hungarianCalendarDay(date);
  if (calendar.kind === "HOLIDAY")
    return { ...blank(date, "HOLIDAY", "CALENDAR"), holiday: calendar.name };
  if (calendar.kind === "SWAPPED_REST")
    return blank(date, "SWAPPED_REST", "CALENDAR");

  const schedule = scheduleOn(schedules, date);
  if (!schedule) return blank(date, "NO_SCHEDULE", "NONE");
  const weekday = isoWeekday(
    calendar.kind === "SWAPPED_WORK" ? calendar.standsFor : date,
  );
  const day = schedule.days.find((d) => d.weekday === weekday);
  if (!day) return blank(date, "FREE", "SCHEDULE");
  return {
    ...blank(date, "WORK", "SCHEDULE"),
    start: day.start,
    end: day.end,
    minutes: span(day.start, day.end),
  };
}

/** The sheet of one employee for one month, from the schedule versions and the month's day entries. */
export function attendanceSheet(input: {
  month: string;
  schedules: readonly AttendanceSchedule[];
  entries: readonly AttendanceDayEntry[];
}): AttendanceSheet {
  if (!isAttendanceMonth(input.month))
    throw new Error(`Nem érvényes hónap: ${input.month}`);
  const entries = new Map(input.entries.map((entry) => [entry.date, entry]));
  const rows = monthDays(input.month).map((date) =>
    rowOf(date, entries.get(date), input.schedules),
  );
  const year = Number(input.month.slice(0, 4));
  return {
    month: input.month,
    rows,
    totalMinutes: rows.reduce((sum, row) => sum + row.minutes, 0),
    sickDays: rows.filter((row) => row.kind === "SICK").length,
    leaveDays: rows.filter((row) => row.kind === "LEAVE").length,
    swapsDecree: HUNGARIAN_WORKDAY_SWAPS[year]?.decree ?? null,
  };
}
