import type {
  AttendanceSchedule,
  AttendanceScheduleDay,
  AttendanceScheduleListResponse,
} from "@acropora/types";

import { apiRequest } from "./client";

const base = "/attendance/users";

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
};
