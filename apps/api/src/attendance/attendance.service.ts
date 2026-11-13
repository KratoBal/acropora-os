import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  attendanceDayProblem,
  attendanceSheet,
  isAttendanceMonth,
  monthDays,
  attendanceWeekProblem,
  isAttendanceDate,
  isAttendanceEmployeeRole,
  parseAttendanceClock,
  USER_ROLES,
  type AttendanceDayEntry,
  type AttendanceDayInput,
  type AttendanceDayListResponse,
  type AttendanceEmployeeListResponse,
  type AttendanceSchedule,
  type AttendanceScheduleDay,
  type AttendanceScheduleListResponse,
  type AttendanceSheet,
  type AttendanceSheetResponse,
} from "@acropora/types";

import {
  dateOnly,
  dayView,
  scheduleView,
  sheetContentHash,
} from "./attendance-records.js";
import { attendanceSheetDocument } from "./attendance-sheet-document.js";
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

  /**
   * THE PICKER OF THE SHEET PAGE (S2b): every account with a sheet, inactive ones too (a past month stays editable). Its
   * own route under `attendance.manage`, because the user list is `users.manage`, and someone given only
   * `attendance.manage` must still reach the sheets (barracuda on #2501).
   */
  async employees(): Promise<AttendanceEmployeeListResponse> {
    const items = await this.repository.employees(
      USER_ROLES.filter(isAttendanceEmployeeRole),
    );
    return { items };
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

  /**
   * THE MONTH'S SHEET (S2a), computed from every schedule version and the month's entries by the shared
   * `attendanceSheet`. Any month, the current one too (Luca: downloadable any time, as it stands).
   */
  /** The month computed, for one employee (shared by the screen, the PDF and the signed copy). */
  private async computedSheet(
    userId: string,
    month: string,
  ): Promise<{ sheet: AttendanceSheet; displayName: string }> {
    if (!isAttendanceMonth(month))
      throw new BadRequestException(`Nem érvényes hónap: ${month}`);
    const user = await this.employee(userId);
    const days = monthDays(month);
    const [schedules, entries] = await Promise.all([
      this.repository.schedules(userId),
      this.repository.days(
        userId,
        dateOnly(days[0]!),
        dateOnly(days[days.length - 1]!),
      ),
    ]);
    const sheet = attendanceSheet({
      month,
      schedules: schedules.map(scheduleView),
      entries: entries.map(dayView),
    });
    return { sheet, displayName: user.displayName };
  }

  /**
   * THE MONTH'S SHEET (S2a), with the latest copy printed for signature (S2d) and whether the month changed since it was
   * printed: a changed signed month keeps its old PDF and is flagged, never silently replaced (brief point 8).
   */
  async sheet(userId: string, month: string): Promise<AttendanceSheetResponse> {
    const { sheet } = await this.computedSheet(userId, month);
    const signed = await this.repository.latestSignedSheet(userId, month);
    return {
      userId,
      ...sheet,
      signedCopy: signed
        ? {
            id: signed.id,
            printedAt: signed.printedAt.toISOString(),
            differs: signed.contentHash !== sheetContentHash(sheet),
          }
        : null,
    };
  }

  /**
   * THE MONTH'S SHEET AS A PDF (S2c): the same computed sheet, printed with the employee's official name (`displayName`, the
   * name for documents). Any month, the current one too, as it stands at `printedAt`. Nothing is kept.
   */
  async sheetPdf(
    userId: string,
    month: string,
    printedAt: Date,
  ): Promise<{ bytes: Buffer; fileName: string }> {
    const { sheet, displayName } = await this.computedSheet(userId, month);
    const bytes = await attendanceSheetDocument({
      sheet,
      employeeName: displayName,
      printedAt,
    });
    return { bytes, fileName: `Jelenléti ív ${displayName} ${month}.pdf` };
  }

  /**
   * PRINTED FOR SIGNATURE (S2d): the same PDF, and these exact bytes are kept with the hash of the sheet they show. From then
   * on the sheet says whether the month still matches the signed copy.
   */
  async printForSignature(
    userId: string,
    month: string,
    printedAt: Date,
    actorId: string,
  ): Promise<{ bytes: Buffer; fileName: string }> {
    const { sheet, displayName } = await this.computedSheet(userId, month);
    const bytes = await attendanceSheetDocument({
      sheet,
      employeeName: displayName,
      printedAt,
    });
    await this.repository.createSignedSheet({
      userId,
      month,
      contentHash: sheetContentHash(sheet),
      pdf: bytes,
      printedAt,
      actorId,
    });
    return {
      bytes,
      fileName: `Jelenléti ív ${displayName} ${month} (aláírásra).pdf`,
    };
  }

  /** A kept copy, as it was printed. */
  async signedSheetPdf(
    userId: string,
    id: string,
  ): Promise<{ bytes: Buffer; fileName: string }> {
    const user = await this.employee(userId);
    const copy = await this.repository.signedSheetPdf(userId, id);
    if (!copy)
      throw new NotFoundException("Nincs ilyen aláírásra nyomtatott példány.");
    return {
      bytes: Buffer.from(copy.pdf),
      fileName: `Jelenléti ív ${user.displayName} ${copy.month} (aláírt példány).pdf`,
    };
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
