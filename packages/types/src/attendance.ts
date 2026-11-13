import { HUMAN_ROLES, INTERNAL_ROLES, type UserRole } from "./auth.js";

/**
 * THE ATTENDANCE SHEET (task os-jelenleti-iv, S1; Balázs 2026-11-13 07:58 UTC: "legyen a kollegankent beallithato heti rend
 * es kesz").
 *
 * Two things are stored, nothing else: a WEEKLY SCHEDULE per employee (arrival and departure for each working weekday), and a
 * DAY ENTRY where a single day differs from it (sick, leave, day off, or other times). The sheet is computed from the two; no
 * time is ever generated or shifted (the brief rejects random offsets: the sheet shows real times).
 *
 * A schedule has a `validFrom` date, and the sheet of a day uses the latest version not after it: changing the schedule from
 * December must not rewrite November, which may already be signed.
 *
 * Times travel as "HH:MM" and are stored as minutes after midnight. A shift never crosses midnight (a shop day), so the
 * departure is always after the arrival on the same day.
 */
export const ATTENDANCE_DAY_KINDS = [
  "WORKED",
  "SICK",
  "LEAVE",
  "DAY_OFF",
] as const;
export type AttendanceDayKind = (typeof ATTENDANCE_DAY_KINDS)[number];

/** Labels for the screens; the sheet itself prints "B" and "SZ" (Luca's paper format). */
export const ATTENDANCE_DAY_KIND_LABELS: Readonly<
  Record<AttendanceDayKind, string>
> = {
  WORKED: "Eltérő munkaidő",
  SICK: "Betegség (B)",
  LEAVE: "Szabadság (SZ)",
  DAY_OFF: "Szabadnap",
};

/** ISO weekday: 1 is Monday, 7 is Sunday. A weekday missing from a schedule is a free day. */
export const ATTENDANCE_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

export interface AttendanceScheduleDay {
  weekday: number;
  /** Arrival, "HH:MM". */
  start: string;
  /** Departure, "HH:MM", after the arrival. */
  end: string;
}

export interface AttendanceSchedule {
  /** "YYYY-MM-DD": the first day this week applies. */
  validFrom: string;
  /** The working weekdays, Monday first; a missing weekday is free. */
  days: AttendanceScheduleDay[];
  updatedAt: string;
}

export interface AttendanceDayEntry {
  /** "YYYY-MM-DD". */
  date: string;
  kind: AttendanceDayKind;
  /** Only on a WORKED day; null on the others (they print a mark, not times). */
  start: string | null;
  end: string | null;
  updatedAt: string;
}

export interface AttendanceScheduleListResponse {
  userId: string;
  /** Newest first. */
  items: AttendanceSchedule[];
}

export interface AttendanceDayListResponse {
  userId: string;
  from: string;
  to: string;
  /** Date order. Only the days that differ from the schedule; every other day follows it. */
  items: AttendanceDayEntry[];
}

/** An employee in the attendance sheet's picker (S2b): our own human colleagues, the inactive ones too (past months). */
export interface AttendanceEmployee {
  id: string;
  /** The official full name: the sheet and its PDF print this. */
  displayName: string;
  nickname: string | null;
  role: UserRole;
  isActive: boolean;
}

export interface AttendanceEmployeeListResponse {
  items: AttendanceEmployee[];
}

export interface AttendanceDayInput {
  kind: AttendanceDayKind;
  start?: string | null;
  end?: string | null;
}

/**
 * WHO HAS AN ATTENDANCE SHEET: our own human colleagues. A partner account (`PARTNER_SERVICE`) is someone else's employee,
 * and a machine account has no working hours.
 */
export const isAttendanceEmployeeRole = (role: UserRole): boolean =>
  HUMAN_ROLES.includes(role) && INTERNAL_ROLES.includes(role);

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar day as "YYYY-MM-DD" (2026-02-30 is not one). */
export function isAttendanceDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [year, month, day] = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
  ];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "07:30" -> 450; null when it is not a time of day. */
export function parseAttendanceClock(value: string): number | null {
  const match = CLOCK.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** 450 -> "07:30". */
export function formatAttendanceClock(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** Why an arrival and departure pair is refused, in the words the screen shows; null when it is fine. */
export function attendanceRangeProblem(
  start: string,
  end: string,
): string | null {
  const from = parseAttendanceClock(start);
  const to = parseAttendanceClock(end);
  if (from === null) return `Az érkezés nem érvényes időpont: ${start}`;
  if (to === null) return `A távozás nem érvényes időpont: ${end}`;
  if (to <= from) return "A távozásnak az érkezés után kell lennie.";
  return null;
}

/** Why a weekly schedule is refused; null when it is fine. An empty week is allowed (nobody is scheduled, e.g. long leave). */
export function attendanceWeekProblem(
  days: readonly AttendanceScheduleDay[],
): string | null {
  const seen = new Set<number>();
  for (const day of days) {
    if (!(ATTENDANCE_WEEKDAYS as readonly number[]).includes(day.weekday))
      return `Ismeretlen nap: ${day.weekday}`;
    if (seen.has(day.weekday))
      return `Egy nap kétszer szerepel: ${day.weekday}`;
    seen.add(day.weekday);
    const problem = attendanceRangeProblem(day.start, day.end);
    if (problem) return problem;
  }
  return null;
}

/**
 * Why a day entry is refused; null when it is fine. A WORKED day needs both times (that is all it says); the marks carry no
 * times, because the sheet prints the mark in their place and a stray time would be printed nowhere and believed somewhere.
 */
export function attendanceDayProblem(input: AttendanceDayInput): string | null {
  if (!(ATTENDANCE_DAY_KINDS as readonly string[]).includes(input.kind))
    return `Ismeretlen jelölés: ${String(input.kind)}`;
  const hasStart = input.start !== undefined && input.start !== null;
  const hasEnd = input.end !== undefined && input.end !== null;
  if (input.kind === "WORKED") {
    if (!hasStart || !hasEnd)
      return "Eltérő munkaidőnél az érkezést és a távozást is meg kell adni.";
    return attendanceRangeProblem(input.start!, input.end!);
  }
  if (hasStart || hasEnd)
    return "Betegség, szabadság és szabadnap mellé nem tartozik időpont.";
  return null;
}

/**
 * WHAT AN EMPLOYEE MAY MARK FOR THEMSELVES (os-jelenleti-iv, S3; brief point 3): leave and day off, IN ADVANCE, from
 * tomorrow on. Sick days, other times and anything in the past stay with the admin (`attendance.manage`), and so does a day
 * an admin already marked otherwise: the employee neither overwrites nor removes it.
 */
export const ATTENDANCE_SELF_KINDS = [
  "LEAVE",
  "DAY_OFF",
] as const satisfies readonly AttendanceDayKind[];

/** The sentence for a day an admin already marked otherwise (also the API's 409 when that happens during the write). */
export const ATTENDANCE_SELF_TAKEN =
  "Ezen a napon már más jelölés áll; módosítani az adminisztrátor tud.";

const isSelfKind = (kind: AttendanceDayKind | null | undefined) =>
  kind !== null &&
  kind !== undefined &&
  (ATTENDANCE_SELF_KINDS as readonly string[]).includes(kind);

/** Why an employee may not set or remove their own mark on `date`; null when they may. `today` is the Budapest day. */
export function attendanceSelfMarkProblem(input: {
  /** The mark to set; undefined when removing. */
  kind?: AttendanceDayKind;
  date: string;
  today: string;
  /** The kind already on the day, or null. */
  existing: AttendanceDayKind | null;
}): string | null {
  if (input.kind !== undefined && !isSelfKind(input.kind))
    return "Magadnak csak szabadságot vagy szabadnapot jelölhetsz.";
  if (!isAttendanceDate(input.date)) return `Nem érvényes dátum: ${input.date}`;
  if (input.date <= input.today)
    return "Előre, a holnapi vagy egy későbbi napra jelölhetsz; a mai és a korábbi napokat az adminisztrátor módosítja.";
  if (input.existing !== null && !isSelfKind(input.existing))
    return ATTENDANCE_SELF_TAKEN;
  return null;
}
