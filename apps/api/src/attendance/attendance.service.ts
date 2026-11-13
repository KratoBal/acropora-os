import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  attendanceDayProblem,
  attendanceWeekProblem,
  isAttendanceDate,
  isAttendanceEmployeeRole,
  parseAttendanceClock,
  type AttendanceDayEntry,
  type AttendanceDayInput,
  type AttendanceDayListResponse,
  type AttendanceSchedule,
  type AttendanceScheduleDay,
  type AttendanceScheduleListResponse,
} from "@acropora/types";

import { dateOnly, dayView, scheduleView } from "./attendance-records.js";
import { AttendanceRepository } from "./attendance.repository.js";

export const ATTENDANCE_USER_NOT_FOUND = "A felhasználó nem található.";
export const ATTENDANCE_NOT_AN_EMPLOYEE =
  "Ennek a fióknak nincs jelenléti íve: partner- és gépi fiók nem munkatárs.";
/** A year and a day: wide enough for any month view, narrow enough that one request cannot read a whole history. */
export const ATTENDANCE_MAX_RANGE_DAYS = 366;

const DAY_MS = 24 * 60 * 60 * 1000;

function date(value: string, label: string): Date {
  if (!isAttendanceDate(value))
    throw new BadRequestException(`${label} nem érvényes dátum: ${value}`);
  return dateOnly(value);
}

/** The shared check's sentence as a 400; the times as minutes (they are valid once the check passed). */
const minutes = (clock: string) => parseAttendanceClock(clock)!;

/**
 * THE ATTENDANCE SHEET'S INPUTS, kept by an admin (os-jelenleti-iv, S1): an employee's weekly schedule versions and the days
 * that differ from them. All under `attendance.manage` (the controller). The employee's own advance marks are S3, the sheet
 * and its PDF S2.
 *
 * Past dates are deliberately writable (Luca 2026-11-13 07:49: the accountant books leave, she reconciles later); what makes
 * that safe is the audit row with the old and the new value, written in the same transaction.
 */
@Injectable()
export class AttendanceService {
  constructor(private readonly repository: AttendanceRepository) {}

  private async employee(userId: string) {
    const user = await this.repository.employee(userId);
    if (!user) throw new NotFoundException(ATTENDANCE_USER_NOT_FOUND);
    if (!isAttendanceEmployeeRole(user.role))
      throw new BadRequestException(ATTENDANCE_NOT_AN_EMPLOYEE);
    return user;
  }

  async schedules(userId: string): Promise<AttendanceScheduleListResponse> {
    await this.employee(userId);
    const rows = await this.repository.schedules(userId);
    return { userId, items: rows.map(scheduleView) };
  }

  async saveSchedule(
    userId: string,
    validFrom: string,
    days: readonly AttendanceScheduleDay[],
    actorId: string,
  ): Promise<AttendanceSchedule> {
    const from = date(validFrom, "A kezdőnap");
    const problem = attendanceWeekProblem(days);
    if (problem) throw new BadRequestException(problem);
    await this.employee(userId);
    const saved = await this.repository.saveSchedule({
      userId,
      validFrom: from,
      days: [...days]
        .sort((a, b) => a.weekday - b.weekday)
        .map((day) => ({
          weekday: day.weekday,
          startMinute: minutes(day.start),
          endMinute: minutes(day.end),
        })),
      actorId,
    });
    return scheduleView(saved);
  }

  async deleteSchedule(
    userId: string,
    validFrom: string,
    actorId: string,
  ): Promise<void> {
    const from = date(validFrom, "A kezdőnap");
    await this.employee(userId);
    const removed = await this.repository.deleteSchedule({
      userId,
      validFrom: from,
      actorId,
    });
    if (!removed)
      throw new NotFoundException(
        `Nincs ${validFrom} napon kezdődő munkarend.`,
      );
  }

  async days(
    userId: string,
    fromText: string,
    toText: string,
  ): Promise<AttendanceDayListResponse> {
    const from = date(fromText, "A kezdőnap");
    const to = date(toText, "Az utolsó nap");
    if (to < from)
      throw new BadRequestException(
        "Az utolsó nap nem lehet a kezdőnap előtt.",
      );
    if (
      (to.getTime() - from.getTime()) / DAY_MS + 1 >
      ATTENDANCE_MAX_RANGE_DAYS
    )
      throw new BadRequestException(
        `Egyszerre legfeljebb ${ATTENDANCE_MAX_RANGE_DAYS} nap kérhető le.`,
      );
    await this.employee(userId);
    const rows = await this.repository.days(userId, from, to);
    return { userId, from: fromText, to: toText, items: rows.map(dayView) };
  }

  async saveDay(
    userId: string,
    dayText: string,
    input: AttendanceDayInput,
    actorId: string,
  ): Promise<AttendanceDayEntry> {
    const day = date(dayText, "A nap");
    const problem = attendanceDayProblem(input);
    if (problem) throw new BadRequestException(problem);
    await this.employee(userId);
    const worked = input.kind === "WORKED";
    const saved = await this.repository.saveDay({
      userId,
      date: day,
      kind: input.kind,
      startMinute: worked ? minutes(input.start!) : null,
      endMinute: worked ? minutes(input.end!) : null,
      actorId,
    });
    return dayView(saved);
  }

  async deleteDay(
    userId: string,
    dayText: string,
    actorId: string,
  ): Promise<void> {
    const day = date(dayText, "A nap");
    await this.employee(userId);
    const removed = await this.repository.deleteDay({
      userId,
      date: day,
      actorId,
    });
    if (!removed)
      throw new NotFoundException(
        `${dayText}: ezen a napon nincs eltérés a munkarendtől.`,
      );
  }
}
