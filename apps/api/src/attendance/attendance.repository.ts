import { Injectable } from "@nestjs/common";
import { prisma, type Prisma } from "@acropora/database";
import type {
  AttendanceDayKind,
  AttendanceEmployee,
  UserRole,
} from "@acropora/types";

import {
  ATTENDANCE_AUDIT_ACTIONS,
  dayAuditValue,
  dateKey,
  sameAuditValue,
  weekAuditValue,
  type DayRow,
  type ScheduleDayRow,
  type ScheduleRow,
} from "./attendance-records.js";

const scheduleSelect = {
  validFrom: true,
  updatedAt: true,
  days: {
    select: { weekday: true, startMinute: true, endMinute: true },
    orderBy: { weekday: "asc" },
  },
} as const;

const daySelect = {
  date: true,
  kind: true,
  startMinute: true,
  endMinute: true,
  updatedAt: true,
  // who set the entry: the own sheet offers to change only the employee's own marks (S3)
  updatedById: true,
} as const;

type Tx = Prisma.TransactionClient;

/** The S3 guard, read under the lock: the existing entry's kind must be allowed, and (`onlyOwn`) the actor its author. */
function guardRefuses(
  existing: { kind: AttendanceDayKind; updatedById: string | null },
  input: {
    actorId: string;
    onlyOver?: readonly AttendanceDayKind[];
    onlyOwn?: boolean;
  },
): boolean {
  if (input.onlyOver && !input.onlyOver.includes(existing.kind)) return true;
  return input.onlyOwn === true && existing.updatedById !== input.actorId;
}

/** The day already carries a mark the caller may not replace or remove (S3: an employee over an admin's mark). */
export class AttendanceDayTakenError extends Error {
  constructor(readonly kind: AttendanceDayKind) {
    super(`attendance day taken by ${kind}`);
  }
}

/**
 * THE ATTENDANCE STORE (os-jelenleti-iv, S1). Every write runs in one transaction with its audit row, under the employee's
 * row lock (`SELECT ... FOR NO KEY UPDATE` on the user): the old value the audit records is read inside the lock, so two
 * admins saving the same day at once are serialized and each log row names the value it really replaced. Not FOR UPDATE:
 * that would also hold up every other insert pointing at the user (a session, a message) through its foreign-key check
 * (barracuda on #2498).
 *
 * A save that changes nothing writes nothing and logs nothing.
 */
@Injectable()
export class AttendanceRepository {
  private readonly database = prisma;

  employee(
    id: string,
  ): Promise<{ id: string; role: UserRole; displayName: string } | null> {
    return this.database.user.findUnique({
      where: { id },
      select: { id: true, role: true, displayName: true },
    });
  }

  /** The accounts of these roles, active first, then by name. */
  employees(roles: readonly UserRole[]): Promise<AttendanceEmployee[]> {
    return this.database.user.findMany({
      where: { role: { in: [...roles] } },
      orderBy: [{ isActive: "desc" }, { displayName: "asc" }],
      select: {
        id: true,
        displayName: true,
        nickname: true,
        role: true,
        isActive: true,
      },
    });
  }

  schedules(userId: string): Promise<ScheduleRow[]> {
    return this.database.attendanceSchedule.findMany({
      where: { userId },
      orderBy: { validFrom: "desc" },
      select: scheduleSelect,
    });
  }

  days(userId: string, from: Date, to: Date): Promise<DayRow[]> {
    return this.database.attendanceDay.findMany({
      where: { userId, date: { gte: from, lte: to } },
      orderBy: { date: "asc" },
      select: daySelect,
    });
  }

  private async lockEmployee(tx: Tx, userId: string) {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR NO KEY UPDATE`;
  }

  private async audit(
    tx: Tx,
    input: {
      actorId: string;
      userId: string;
      action: string;
      metadata: Record<string, unknown>;
    },
  ) {
    await tx.auditLog.create({
      data: {
        userId: input.actorId,
        action: input.action,
        entityType: "User",
        entityId: input.userId,
        // the values are JSON by construction (strings, numbers, null); the cast only drops the index signature
        metadata: input.metadata as unknown as Prisma.JsonObject,
      },
    });
  }

  /** The month's latest copy printed for signature (S2d), without its bytes. */
  latestSignedSheet(
    userId: string,
    month: string,
  ): Promise<{ id: string; printedAt: Date; contentHash: string } | null> {
    return this.database.attendanceSignedSheet.findFirst({
      where: { userId, month },
      orderBy: { printedAt: "desc" },
      select: { id: true, printedAt: true, contentHash: true },
    });
  }

  /** A kept copy's PDF, only under its own employee (an id from another person's page reads nothing). */
  signedSheetPdf(
    userId: string,
    id: string,
  ): Promise<{ pdf: Uint8Array; month: string; printedAt: Date } | null> {
    return this.database.attendanceSignedSheet.findFirst({
      where: { id, userId },
      select: { pdf: true, month: true, printedAt: true },
    });
  }

  /** Keeps the PDF handed out for signing, with its audit row, in one transaction. */
  createSignedSheet(input: {
    userId: string;
    month: string;
    contentHash: string;
    pdf: Buffer;
    printedAt: Date;
    actorId: string;
  }): Promise<{ id: string }> {
    return this.database.$transaction(async (tx) => {
      const saved = await tx.attendanceSignedSheet.create({
        data: {
          userId: input.userId,
          month: input.month,
          contentHash: input.contentHash,
          pdf: Uint8Array.from(input.pdf),
          printedAt: input.printedAt,
          printedById: input.actorId,
        },
        select: { id: true },
      });
      await this.audit(tx, {
        actorId: input.actorId,
        userId: input.userId,
        action: ATTENDANCE_AUDIT_ACTIONS.printed,
        metadata: {
          month: input.month,
          signedSheetId: saved.id,
          contentHash: input.contentHash,
        },
      });
      return saved;
    });
  }

  /** Creates or replaces the schedule version starting on `validFrom`. */
  saveSchedule(input: {
    userId: string;
    validFrom: Date;
    days: ScheduleDayRow[];
    actorId: string;
  }): Promise<ScheduleRow> {
    return this.database.$transaction(async (tx) => {
      await this.lockEmployee(tx, input.userId);
      const key = {
        userId_validFrom: { userId: input.userId, validFrom: input.validFrom },
      };
      const existing = await tx.attendanceSchedule.findUnique({
        where: key,
        select: { id: true, ...scheduleSelect },
      });
      const from = weekAuditValue(existing?.days ?? null);
      const to = weekAuditValue(input.days);
      if (existing && sameAuditValue(from, to)) return existing;

      const saved = await tx.attendanceSchedule.upsert({
        where: key,
        update: { updatedById: input.actorId },
        create: {
          userId: input.userId,
          validFrom: input.validFrom,
          updatedById: input.actorId,
        },
        select: { id: true },
      });
      await tx.attendanceScheduleDay.deleteMany({
        where: { scheduleId: saved.id },
      });
      if (input.days.length)
        await tx.attendanceScheduleDay.createMany({
          data: input.days.map((day) => ({ scheduleId: saved.id, ...day })),
        });
      await this.audit(tx, {
        actorId: input.actorId,
        userId: input.userId,
        action: ATTENDANCE_AUDIT_ACTIONS.schedule,
        metadata: { validFrom: dateKey(input.validFrom), from, to },
      });
      return tx.attendanceSchedule.findUniqueOrThrow({
        where: { id: saved.id },
        select: scheduleSelect,
      });
    });
  }

  /** Removes the schedule version starting on `validFrom`; false when there was none. */
  deleteSchedule(input: {
    userId: string;
    validFrom: Date;
    actorId: string;
  }): Promise<boolean> {
    return this.database.$transaction(async (tx) => {
      await this.lockEmployee(tx, input.userId);
      const existing = await tx.attendanceSchedule.findUnique({
        where: {
          userId_validFrom: {
            userId: input.userId,
            validFrom: input.validFrom,
          },
        },
        select: { id: true, days: scheduleSelect.days },
      });
      if (!existing) return false;
      await tx.attendanceSchedule.delete({ where: { id: existing.id } });
      await this.audit(tx, {
        actorId: input.actorId,
        userId: input.userId,
        action: ATTENDANCE_AUDIT_ACTIONS.schedule,
        metadata: {
          validFrom: dateKey(input.validFrom),
          from: weekAuditValue(existing.days),
          to: null,
        },
      });
      return true;
    });
  }

  /** Sets the day's entry (one per employee and date). */
  saveDay(input: {
    userId: string;
    date: Date;
    kind: AttendanceDayKind;
    startMinute: number | null;
    endMinute: number | null;
    actorId: string;
    /** S3: replace only an entry of these kinds (or none); another throws `AttendanceDayTakenError`, read under the lock. */
    onlyOver?: readonly AttendanceDayKind[];
    /** S3: and only one the actor set themselves (barracuda on #2515: an admin's leave is not the employee's to undo). */
    onlyOwn?: boolean;
  }): Promise<DayRow> {
    return this.database.$transaction(async (tx) => {
      await this.lockEmployee(tx, input.userId);
      const key = { userId_date: { userId: input.userId, date: input.date } };
      const existing = await tx.attendanceDay.findUnique({
        where: key,
        select: { ...daySelect, updatedById: true },
      });
      if (existing && guardRefuses(existing, input))
        throw new AttendanceDayTakenError(existing.kind);
      const from = dayAuditValue(existing);
      const to = dayAuditValue(input);
      if (existing && sameAuditValue(from, to)) return existing;

      const values = {
        kind: input.kind,
        startMinute: input.startMinute,
        endMinute: input.endMinute,
        updatedById: input.actorId,
      };
      const saved = await tx.attendanceDay.upsert({
        where: key,
        update: values,
        create: { userId: input.userId, date: input.date, ...values },
        select: daySelect,
      });
      await this.audit(tx, {
        actorId: input.actorId,
        userId: input.userId,
        action: ATTENDANCE_AUDIT_ACTIONS.day,
        metadata: { date: dateKey(input.date), from, to },
      });
      return saved;
    });
  }

  /** Removes the day's entry, so the day follows the schedule again; false when there was none. */
  deleteDay(input: {
    userId: string;
    date: Date;
    actorId: string;
    /** S3: remove only an entry of these kinds; another throws `AttendanceDayTakenError`. */
    onlyOver?: readonly AttendanceDayKind[];
    /** S3: and only one the actor set themselves. */
    onlyOwn?: boolean;
  }): Promise<boolean> {
    return this.database.$transaction(async (tx) => {
      await this.lockEmployee(tx, input.userId);
      const key = { userId_date: { userId: input.userId, date: input.date } };
      const existing = await tx.attendanceDay.findUnique({
        where: key,
        select: { ...daySelect, updatedById: true },
      });
      if (!existing) return false;
      if (guardRefuses(existing, input))
        throw new AttendanceDayTakenError(existing.kind);
      await tx.attendanceDay.delete({ where: key });
      await this.audit(tx, {
        actorId: input.actorId,
        userId: input.userId,
        action: ATTENDANCE_AUDIT_ACTIONS.day,
        metadata: {
          date: dateKey(input.date),
          from: dayAuditValue(existing),
          to: null,
        },
      });
      return true;
    });
  }
}
