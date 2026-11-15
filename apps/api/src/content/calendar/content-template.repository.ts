import { Injectable } from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";
import {
  CONTENT_TEMPLATE_EVENT_KINDS,
  type ContentTemplateRule,
} from "@acropora/types";

import { changedFields } from "./calendar-event.repository.js";

/** What the service writes: checked and trimmed. */
export interface ContentTemplateRuleWrite {
  eventKind: ContentTemplateRule["eventKind"];
  label: string;
  channel: ContentTemplateRule["channel"];
  anchor: ContentTemplateRule["anchor"];
  offsetDays: number;
  active: boolean;
}

const SELECT = {
  id: true,
  eventKind: true,
  label: true,
  channel: true,
  anchor: true,
  offsetDays: true,
  active: true,
  sortOrder: true,
  updatedAt: true,
} satisfies Prisma.ContentTemplateRuleSelect;

type Row = Prisma.ContentTemplateRuleGetPayload<{ select: typeof SELECT }>;

const ENTITY = "ContentTemplateRule";

const view = (row: Row): ContentTemplateRule => ({
  ...row,
  updatedAt: row.updatedAt.toISOString(),
});

/** The audit row's picture of a rule: the fields a person wrote. */
const snapshot = (row: Row | ContentTemplateRuleWrite): Prisma.JsonObject => ({
  eventKind: row.eventKind,
  label: row.label,
  channel: row.channel,
  anchor: row.anchor,
  offsetDays: row.offsetDays,
  active: row.active,
});

/** The page's order: by event kind as the calendar lists them, then the row's own place, then its age. */
export function templateOrder(
  a: ContentTemplateRule,
  b: ContentTemplateRule,
): number {
  return (
    CONTENT_TEMPLATE_EVENT_KINDS.indexOf(a.eventKind) -
      CONTENT_TEMPLATE_EVENT_KINDS.indexOf(b.eventKind) ||
    a.sortOrder - b.sortOrder ||
    a.id.localeCompare(b.id)
  );
}

/**
 * THE DEPENDENCY TEMPLATE (T5.5 S4). Every write leaves an `AuditLog` row in the same transaction, with what changed:
 * the days of a template are a business decision, and "who moved the reminder to two days" must be answerable.
 */
@Injectable()
export class ContentTemplateRepository {
  async list(): Promise<ContentTemplateRule[]> {
    const rows = await prisma.contentTemplateRule.findMany({ select: SELECT });
    return rows.map(view).sort(templateOrder);
  }

  async get(id: string): Promise<ContentTemplateRule | null> {
    const row = await prisma.contentTemplateRule.findUnique({
      where: { id },
      select: SELECT,
    });
    return row ? view(row) : null;
  }

  /** A new row goes to the end of its event kind's rows. */
  async create(
    data: ContentTemplateRuleWrite,
    actorUserId: string,
  ): Promise<ContentTemplateRule> {
    return prisma.$transaction(async (tx) => {
      const last = await tx.contentTemplateRule.aggregate({
        where: { eventKind: data.eventKind },
        _max: { sortOrder: true },
      });
      const row = await tx.contentTemplateRule.create({
        data: { ...data, sortOrder: (last._max.sortOrder ?? 0) + 1 },
        select: SELECT,
      });
      await tx.auditLog.create({
        data: {
          userId: actorUserId,
          action: "content_template_rule.created",
          entityType: ENTITY,
          entityId: row.id,
          metadata: snapshot(row),
        },
      });
      return view(row);
    });
  }

  /**
   * Conditional on the row not having moved since the service read it; an edit that changes nothing writes nothing.
   * "changed" when it moved, null when it is gone.
   */
  async update(
    id: string,
    data: ContentTemplateRuleWrite,
    readAt: string,
    actorUserId: string,
  ): Promise<ContentTemplateRule | "changed" | null> {
    return prisma.$transaction(async (tx) => {
      const before = await tx.contentTemplateRule.findUnique({
        where: { id },
        select: SELECT,
      });
      if (!before) return null;
      if (before.updatedAt.getTime() !== new Date(readAt).getTime())
        return "changed" as const;
      const changes = changedFields(snapshot(before), snapshot(data));
      if (Object.keys(changes).length === 0) return view(before);
      const { count } = await tx.contentTemplateRule.updateMany({
        where: { id, updatedAt: new Date(readAt) },
        data,
      });
      if (count !== 1) return "changed" as const;
      await tx.auditLog.create({
        data: {
          userId: actorUserId,
          action: "content_template_rule.updated",
          entityType: ENTITY,
          entityId: id,
          metadata: changes,
        },
      });
      return view(
        await tx.contentTemplateRule.findUniqueOrThrow({
          where: { id },
          select: SELECT,
        }),
      );
    });
  }
}
