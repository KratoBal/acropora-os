import { Injectable } from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";
import type { CalendarEvent, CalendarEventKind } from "@acropora/types";

/** What the service writes: the two days as `YYYY-MM-DD`, everything already checked and trimmed. */
export interface CalendarEventWrite {
  kind: CalendarEventKind;
  title: string;
  startsOn: string;
  endsOn: string;
  location: string | null;
  responsibleUserId: string | null;
}

const SELECT = {
  id: true,
  kind: true,
  title: true,
  startsOn: true,
  endsOn: true,
  location: true,
  responsibleUserId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CalendarEventSelect;

type Row = Prisma.CalendarEventGetPayload<{ select: typeof SELECT }>;

const ENTITY = "CalendarEvent";

/** A `@db.Date` value back to its day: the column stores UTC midnight, so the UTC date IS the day. */
export const calendarEventDay = (value: Date) =>
  value.toISOString().slice(0, 10);

const dateColumn = (day: string) => new Date(`${day}T00:00:00.000Z`);

/** The name the team uses (the nickname when set), by user id; an id with no user is simply absent. */
export async function responsibleNames(
  ids: readonly string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, displayName: true, nickname: true },
  });
  return new Map(
    users.map((user) => [user.id, user.nickname?.trim() || user.displayName]),
  );
}

/** Exported for the test: the row as the API returns it. */
export function calendarEventView(
  row: Row,
  names: ReadonlyMap<string, string>,
): CalendarEvent {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    startsOn: calendarEventDay(row.startsOn),
    endsOn: calendarEventDay(row.endsOn),
    location: row.location,
    responsible: row.responsibleUserId
      ? {
          id: row.responsibleUserId,
          name: names.get(row.responsibleUserId) ?? null,
        }
      : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The audit row's picture of an event: the fields a person wrote, not the timestamps. */
function snapshot(row: Row | CalendarEventWrite): Prisma.JsonObject {
  return {
    kind: row.kind,
    title: row.title,
    startsOn:
      typeof row.startsOn === "string"
        ? row.startsOn
        : calendarEventDay(row.startsOn),
    endsOn:
      typeof row.endsOn === "string"
        ? row.endsOn
        : calendarEventDay(row.endsOn),
    location: row.location,
    responsibleUserId: row.responsibleUserId,
  };
}

/** The fields an edit changed, each as `{ from, to }`: the log says what moved, not only that something did. */
export function changedFields(
  before: Prisma.JsonObject,
  after: Prisma.JsonObject,
): Prisma.JsonObject {
  const changes: Prisma.JsonObject = {};
  for (const key of Object.keys(after))
    if (before[key] !== after[key])
      changes[key] = { from: before[key] ?? null, to: after[key] ?? null };
  return changes;
}

/**
 * THE HAND-ENTERED CALENDAR EVENTS (T5.5 S2). Every write and the delete leave an `AuditLog` row in the same
 * transaction: a row that changed with no log line, or a log line for a write that rolled back, cannot happen.
 */
@Injectable()
export class CalendarEventRepository {
  private async view(row: Row): Promise<CalendarEvent> {
    return calendarEventView(
      row,
      await responsibleNames(
        row.responsibleUserId ? [row.responsibleUserId] : [],
      ),
    );
  }

  async get(id: string): Promise<CalendarEvent | null> {
    const row = await prisma.calendarEvent.findUnique({
      where: { id },
      select: SELECT,
    });
    return row ? this.view(row) : null;
  }

  /** Whether the id belongs to a user who can still answer for something (active). */
  async activeUser(id: string): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { id },
      select: { isActive: true },
    });
    return user?.isActive === true;
  }

  async create(
    data: CalendarEventWrite,
    actorUserId: string | null,
  ): Promise<CalendarEvent> {
    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.calendarEvent.create({
        data: {
          ...data,
          startsOn: dateColumn(data.startsOn),
          endsOn: dateColumn(data.endsOn),
          createdById: actorUserId,
        },
        select: SELECT,
      });
      await tx.auditLog.create({
        data: {
          userId: actorUserId,
          action: "calendar_event.created",
          entityType: ENTITY,
          entityId: created.id,
          metadata: snapshot(data),
        },
      });
      return created;
    });
    return this.view(row);
  }

  /**
   * THE WRITE IS CONDITIONAL ON THE ROW NOT HAVING MOVED SINCE THE SERVICE READ IT (`updatedAt` in the where): the
   * service merges the request over the stored record and writes every field, so a second edit landing between the
   * read and the write would otherwise be silently overwritten. "changed" when it moved, null when it is gone.
   */
  async update(
    id: string,
    data: CalendarEventWrite,
    readAt: string,
    actorUserId: string | null,
  ): Promise<CalendarEvent | "changed" | null> {
    const row = await prisma.$transaction(async (tx) => {
      const before = await tx.calendarEvent.findUnique({
        where: { id },
        select: SELECT,
      });
      if (!before) return null;
      const { count } = await tx.calendarEvent.updateMany({
        where: { id, updatedAt: new Date(readAt) },
        data: {
          ...data,
          startsOn: dateColumn(data.startsOn),
          endsOn: dateColumn(data.endsOn),
        },
      });
      if (count !== 1) return "changed" as const;
      await tx.auditLog.create({
        data: {
          userId: actorUserId,
          action: "calendar_event.updated",
          entityType: ENTITY,
          entityId: id,
          metadata: changedFields(snapshot(before), snapshot(data)),
        },
      });
      return tx.calendarEvent.findUniqueOrThrow({
        where: { id },
        select: SELECT,
      });
    });
    return row === null || row === "changed" ? row : this.view(row);
  }

  /** The log keeps what was deleted: the event is gone from the calendar, not from the record. False when there was none. */
  async delete(id: string, actorUserId: string | null): Promise<boolean> {
    return prisma.$transaction(async (tx) => {
      const before = await tx.calendarEvent.findUnique({
        where: { id },
        select: SELECT,
      });
      if (!before) return false;
      // a delete landing between the read and this one is a "not found", not a 500
      const { count } = await tx.calendarEvent.deleteMany({ where: { id } });
      if (count !== 1) return false;
      await tx.auditLog.create({
        data: {
          userId: actorUserId,
          action: "calendar_event.deleted",
          entityType: ENTITY,
          entityId: id,
          metadata: snapshot(before),
        },
      });
      return true;
    });
  }
}
