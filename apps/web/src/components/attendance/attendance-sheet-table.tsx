"use client";

import { PilotButton } from "@acropora/ui";
import type { AttendanceSheet, AttendanceSheetRow } from "@acropora/types";

import { formatDayHu } from "@/lib/format/date";

export const WEEKDAY_SHORT = ["H", "K", "Sze", "Cs", "P", "Szo", "V"] as const;

/** 540 -> "9:00": hours and minutes, the way the paper sheet reads. */
export function formatAttendanceHours(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

/** What a row says in place of the times. */
export function rowNote(row: AttendanceSheetRow): string {
  // a day after today is empty on every sheet: filled up to today only (Balázs, 2026-11-13)
  if (row.future) return "";
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

const PLANNED_LABELS: Partial<Record<AttendanceSheetRow["kind"], string>> = {
  LEAVE: "Szabadság",
  DAY_OFF: "Szabadnap",
  SICK: "Betegség",
  WORK: "Eltérő munkaidő",
};

/** An advance mark on a future day, for the screen where it is entered (the employee's own sheet); null otherwise. */
export function plannedNote(row: AttendanceSheetRow): string | null {
  if (!row.future || row.source !== "ENTRY") return null;
  const label = PLANNED_LABELS[row.kind];
  return label ? `Tervezett: ${label}` : null;
}

/** The rows that are not working days by the calendar or the schedule: leave marked there still counts as a day. */
export const RESTING: ReadonlySet<AttendanceSheetRow["kind"]> = new Set([
  "HOLIDAY",
  "SWAPPED_REST",
  "FREE",
  "NO_SCHEDULE",
]);

/**
 * THE MONTH'S ROWS (S2b, shared with the employee's own page in S3): date, arrival, departure, hours as h:mm, and the note;
 * "B" and "SZ" stand in place of the times, as on the paper sheet. A row gets a "Módosítás" button only where `canEdit`
 * says so, so the same table serves the admin (every day) and the employee (their own future days).
 */
export function AttendanceSheetTable({
  sheet,
  canEdit,
  onEdit,
  showPlanned = false,
}: {
  sheet: AttendanceSheet;
  canEdit: (row: AttendanceSheetRow) => boolean;
  onEdit: (row: AttendanceSheetRow) => void;
  /** The employee's own input screen shows their advance marks on future days; every other sheet leaves them empty. */
  showPlanned?: boolean;
}) {
  return (
    <>
      {/* `relative`, as on the other scrolling tables: the header's `sr-only` label is absolutely placed, and without a
          positioned box it is placed against the page at the table's full width, so on a phone the whole page scrolled
          sideways (acrobot's 390 px stage shot, 469 px wide). With it the table scrolls inside its card only. */}
      <div className="relative overflow-x-auto">
        <table className="w-full text-left text-sm" aria-label="Jelenléti ív">
          <thead>
            <tr className="text-xs text-pilot-grey-500">
              <th className="py-2 pr-3 font-medium">Dátum</th>
              <th className="py-2 pr-3 font-medium">Érkezés</th>
              <th className="py-2 pr-3 font-medium">Távozás</th>
              <th className="py-2 pr-3 font-medium">Ledolgozott</th>
              <th className="py-2 pr-3 font-medium">Megjegyzés</th>
              <th className="py-2 font-medium">
                <span className="sr-only">Módosítás</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map((row) => (
              <tr
                key={row.date}
                className={
                  row.future || RESTING.has(row.kind)
                    ? "border-t border-pilot-grey-100 text-pilot-grey-500"
                    : "border-t border-pilot-grey-100"
                }
              >
                <td className="whitespace-nowrap py-1.5 pr-3">
                  {formatDayHu(row.date)} {WEEKDAY_SHORT[row.weekday - 1]}
                </td>
                <td className="py-1.5 pr-3">{row.start ?? row.mark ?? ""}</td>
                <td className="py-1.5 pr-3">{row.end ?? row.mark ?? ""}</td>
                <td className="py-1.5 pr-3">
                  {row.kind === "WORK" && row.end
                    ? formatAttendanceHours(row.minutes)
                    : ""}
                </td>
                <td className="py-1.5 pr-3">
                  {(showPlanned ? plannedNote(row) : null) ?? rowNote(row)}
                </td>
                <td className="py-1.5">
                  {canEdit(row) ? (
                    <PilotButton
                      variant="secondary"
                      aria-label={`${formatDayHu(row.date)} módosítása`}
                      onClick={() => onEdit(row)}
                    >
                      Módosítás
                    </PilotButton>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-sm" aria-label="Összesítés">
        Ledolgozott összesen:{" "}
        <strong>{formatAttendanceHours(sheet.totalMinutes)}</strong> óra ·
        Betegség: {sheet.sickDays} nap · Szabadság: {sheet.leaveDays} nap
      </p>
    </>
  );
}
