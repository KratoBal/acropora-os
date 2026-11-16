/**
 * THE EMPLOYEE'S OWN ATTENDANCE SHEET ON THE PHONE (os-jelenleti-iv, S3b): the shapes and the rules the screen needs.
 *
 * COPIES, NOT IMPORTS: the Expo app does not pull the pnpm workspace packages (docs/MOBILE-DEVELOPMENT.md). The field names
 * copy the server's (`packages/types/src/attendance-sheet.ts`), and `canMarkOwnDay` copies the web's use of
 * `attendanceSelfMarkProblem` (`packages/types/src/attendance.ts`). The server checks the same rule again, under its lock,
 * so a copy that drifts shows a button the server then refuses with its own sentence; it cannot write past the rule.
 */
export type AttendanceSheetRowKind =
  | "WORK"
  | "SICK"
  | "LEAVE"
  | "DAY_OFF"
  | "HOLIDAY"
  | "SWAPPED_REST"
  | "FREE"
  | "NO_SCHEDULE";

export interface AttendanceSheetRow {
  date: string;
  weekday: number;
  kind: AttendanceSheetRowKind;
  start: string | null;
  end: string | null;
  minutes: number;
  mark: "B" | "SZ" | null;
  source: "ENTRY" | "SCHEDULE" | "CALENDAR" | "NONE";
  holiday: string | null;
  /** A day after today (Budapest): the server sends no time, mark or minutes for it (filled up to today only). */
  future: boolean;
  /** The entry was set by the employee themselves (S3); only such a day is theirs to change. */
  ownEntry?: boolean;
}

export interface AttendanceSheet {
  userId: string;
  month: string;
  rows: AttendanceSheetRow[];
  totalMinutes: number;
  sickDays: number;
  leaveDays: number;
  swapsDecree: string | null;
}

export type OwnMark = "LEAVE" | "DAY_OFF";

/** The roles with a sheet: our own human colleagues (not a partner account, not a machine account). */
const NO_SHEET_ROLES = new Set([
  "PARTNER_SERVICE",
  "CONTENT_AGENT",
  "ASSET_IMPORT_AGENT",
  "ASSISTANT",
]);
export const hasAttendanceSheet = (role: string): boolean =>
  !NO_SHEET_ROLES.has(role);

const WEEKDAYS = ["H", "K", "Sze", "Cs", "P", "Szo", "V"] as const;
const MONTHS = [
  "január",
  "február",
  "március",
  "április",
  "május",
  "június",
  "július",
  "augusztus",
  "szeptember",
  "október",
  "november",
  "december",
] as const;

const budapestDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Budapest",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The Budapest calendar day of an instant, "YYYY-MM-DD". */
export const budapestToday = (now: Date): string => budapestDay.format(now);

/** "2026-11" moved by whole months. */
export function shiftMonth(month: string, delta: number): string {
  const index =
    Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** "2026-11" -> "2026. november". */
export const monthLabel = (month: string): string =>
  `${month.slice(0, 4)}. ${MONTHS[Number(month.slice(5, 7)) - 1]}`;

/** "2026-11-02", 1 -> "11. 02. H". */
export const dayLabel = (
  row: Pick<AttendanceSheetRow, "date" | "weekday">,
): string =>
  `${row.date.slice(5, 7)}. ${row.date.slice(8, 10)}. ${WEEKDAYS[row.weekday - 1]}`;

/** 540 -> "9:00". */
export const formatHours = (minutes: number): string =>
  `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;

/** What the row shows for the time: "07:00-16:00", today's "07:00-" before the departure, the mark, or nothing. */
export const rowTimes = (row: AttendanceSheetRow): string =>
  row.start && row.end
    ? `${row.start}-${row.end}`
    : row.start
      ? `${row.start}-`
      : (row.mark ?? "");

/** The hours of a finished working day; nothing for today before the departure or a later day. */
export const rowHours = (row: AttendanceSheetRow): string =>
  row.kind === "WORK" && row.end ? formatHours(row.minutes) : "";

const PLANNED: Partial<Record<AttendanceSheetRowKind, string>> = {
  LEAVE: "Szabadság",
  DAY_OFF: "Szabadnap",
  SICK: "Betegség",
  WORK: "Eltérő munkaidő",
};

/**
 * The note of a row, as on the web's own sheet: a later day is empty, except the employee's own advance mark, shown as
 * planned (this screen is where it is entered).
 */
export function rowNote(row: AttendanceSheetRow): string {
  if (row.future) {
    const planned = row.source === "ENTRY" ? PLANNED[row.kind] : undefined;
    return planned ? `Tervezett: ${planned}` : "";
  }
  switch (row.kind) {
    case "WORK":
      return row.source === "ENTRY" ? "Eltérő munkaidő" : "";
    case "SICK":
      return "Betegség";
    case "LEAVE":
      return "Szabadság";
    case "DAY_OFF":
      return "Szabadnap";
    case "HOLIDAY":
      return row.holiday ?? "Munkaszüneti nap";
    case "SWAPPED_REST":
      return "Áthelyezett pihenőnap";
    case "FREE":
      return "Pihenőnap";
    case "NO_SCHEDULE":
      return "Nincs érvényes munkarend";
  }
}

/** The employee's own mark on a row, or null (no entry, or the admin's other mark). */
export const ownMark = (row: AttendanceSheetRow): OwnMark | null =>
  row.source === "ENTRY" && (row.kind === "LEAVE" || row.kind === "DAY_OFF")
    ? row.kind
    : null;

/**
 * May the employee mark this day: from tomorrow on, and not a day the admin marked otherwise (sick, other times). The
 * same rule as the web's `attendanceSelfMarkProblem`.
 */
export const canMarkOwnDay = (
  row: AttendanceSheetRow,
  today: string,
): boolean =>
  row.date > today &&
  // an admin's booked leave is not the employee's to change (barracuda on #2516; the server refuses it too)
  (row.source !== "ENTRY" || (ownMark(row) !== null && row.ownEntry === true));
