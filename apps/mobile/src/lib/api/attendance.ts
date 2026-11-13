import { apiRequest } from "./client";
import type { AttendanceSheet, OwnMark } from "../attendance/presentation";

/**
 * THE EMPLOYEE'S OWN ATTENDANCE SHEET (os-jelenleti-iv, S3b): the server's `/attendance/me` routes. Every call acts on the
 * signed-in user; there is no user id to send.
 */
const ME = "/attendance/me";

export function getMyAttendanceSheet(month: string) {
  return apiRequest<AttendanceSheet>(
    `${ME}/sheet?month=${encodeURIComponent(month)}`,
  );
}

/** Leave or a day off on one of the employee's own future days. */
export function markMyAttendanceDay(date: string, kind: OwnMark) {
  return apiRequest<unknown>(`${ME}/days/${encodeURIComponent(date)}`, {
    method: "PUT",
    body: JSON.stringify({ kind }),
  });
}

/** Removes the employee's own advance mark: the day follows the schedule again. */
export function clearMyAttendanceDay(date: string) {
  return apiRequest<void>(`${ME}/days/${encodeURIComponent(date)}`, {
    method: "DELETE",
  });
}
