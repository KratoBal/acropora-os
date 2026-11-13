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
}: {
  sheet: AttendanceSheet;
  canEdit: (row: AttendanceSheetRow) => boolean;
  onEdit: (row: AttendanceSheetRow) => void;
}) {
  return (
    <>
      <div className="overflow-x-auto">
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
                  RESTING.has(row.kind)
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
                  {row.kind === "WORK"
                    ? formatAttendanceHours(row.minutes)
                    : ""}
                </td>
                <td className="py-1.5 pr-3">{rowNote(row)}</td>
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
