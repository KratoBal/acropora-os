import type {
  AttendanceDayEntry,
  AttendanceDayInput,
  AttendanceEmployeeListResponse,
  AttendanceSchedule,
  AttendanceScheduleDay,
  AttendanceScheduleListResponse,
  AttendanceSheetResponse,
} from "@acropora/types";

import { API_PREFIX } from "./api-prefix";
import { pdfBlob } from "./billing-documents";
import { apiAuthHeaders, apiRequest } from "./client";

const base = "/attendance/users";
const employeesPath = "/attendance/employees";

/** An employee's attendance inputs (os-jelenleti-iv), all under `attendance.manage`. */
export const attendanceApi = {
  schedules(token: string, userId: string, signal?: AbortSignal) {
    return apiRequest<AttendanceScheduleListResponse>(
      `${base}/${encodeURIComponent(userId)}/schedules`,
      token,
      { signal },
    );
  },
  /** Creates or replaces the version starting on `validFrom` ("2026-11-01"); the earlier versions stay. */
  saveSchedule(
    token: string,
    userId: string,
    validFrom: string,
    days: AttendanceScheduleDay[],
  ) {
    return apiRequest<AttendanceSchedule>(
      `${base}/${encodeURIComponent(userId)}/schedules/${encodeURIComponent(validFrom)}`,
      token,
      { method: "PUT", body: JSON.stringify({ days }) },
    );
  },
  deleteSchedule(token: string, userId: string, validFrom: string) {
    return apiRequest<void>(
      `${base}/${encodeURIComponent(userId)}/schedules/${encodeURIComponent(validFrom)}`,
      token,
      { method: "DELETE" },
    );
  },
  /** Everyone with a sheet, inactive accounts too (S2b). */
  employees(token: string, signal?: AbortSignal) {
    return apiRequest<AttendanceEmployeeListResponse>(employeesPath, token, {
      signal,
    });
  },
  /** The month's computed sheet ("2026-11"). */
  sheet(token: string, userId: string, month: string, signal?: AbortSignal) {
    return apiRequest<AttendanceSheetResponse>(
      `${base}/${encodeURIComponent(userId)}/sheet?month=${encodeURIComponent(month)}`,
      token,
      { signal },
    );
  },
  /** The month's sheet as a PDF, as it stands now (S2c). */
  async sheetPdf(token: string, userId: string, month: string): Promise<Blob> {
    const response = await fetch(
      `${API_PREFIX}${base}/${encodeURIComponent(userId)}/sheet.pdf?month=${encodeURIComponent(month)}`,
      { credentials: "same-origin", headers: apiAuthHeaders(token) },
    );
    return pdfBlob(response, "A jelenléti ív PDF-je nem tölthető le.");
  },
  /** Sets the day's entry (sick, leave, day off, or other times). */
  saveDay(
    token: string,
    userId: string,
    date: string,
    input: AttendanceDayInput,
  ) {
    return apiRequest<AttendanceDayEntry>(
      `${base}/${encodeURIComponent(userId)}/days/${encodeURIComponent(date)}`,
      token,
      { method: "PUT", body: JSON.stringify(input) },
    );
  },
  /** Removes the day's entry: the day follows the schedule and the calendar again. */
  deleteDay(token: string, userId: string, date: string) {
    return apiRequest<void>(
      `${base}/${encodeURIComponent(userId)}/days/${encodeURIComponent(date)}`,
      token,
      { method: "DELETE" },
    );
  },
};
