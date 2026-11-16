import { Injectable } from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";
import {
  CONTENT_RESULT_FIELDS,
  type ContentResultValues,
  type ContentResultWeek,
} from "@acropora/types";

import type { SummaryItem } from "./content-results.view.js";

const WEEK_SELECT = {
  weekStart: true,
  reach: true,
  reactions: true,
  opens: true,
  clicks: true,
  preorders: true,
  orders: true,
  updatedAt: true,
} satisfies Prisma.ContentResultWeekSelect;

type WeekRow = Prisma.ContentResultWeekGetPayload<{
  select: typeof WEEK_SELECT;
}>;

const values = (row: ContentResultValues): ContentResultValues => ({
  reach: row.reach,
  reactions: row.reactions,
  opens: row.opens,
  clicks: row.clicks,
  preorders: row.preorders,
  orders: row.orders,
});

const weekView = (row: WeekRow): ContentResultWeek => ({
  weekStart: row.weekStart.toISOString().slice(0, 10),
  ...values(row),
  updatedAt: row.updatedAt.toISOString(),
});

/**
 * THE RESULT WEEKS (T5.5 S8). A week's write and its audit line go together, and the line says each number from and to:
 * "who wrote 1200 reach on this post, and what was there" must be answerable.
 */
@Injectable()
export class ContentResultsRepository {
  item(
    id: string,
  ): Promise<{ id: string; sentAt: Date | null; state: string } | null> {
    return prisma.contentItem.findUnique({
      where: { id },
      select: { id: true, sentAt: true, state: true },
    });
  }

  async weeks(contentId: string): Promise<ContentResultWeek[]> {
    const rows = await prisma.contentResultWeek.findMany({
      where: { contentId },
      select: WEEK_SELECT,
      orderBy: { weekStart: "asc" },
    });
    return rows.map(weekView);
  }

  async saveWeek(
    contentId: string,
    weekStart: string,
    input: ContentResultValues,
    actorUserId: string,
  ): Promise<void> {
    const day = new Date(`${weekStart}T00:00:00.000Z`);
    await prisma.$transaction(async (tx) => {
      const before = await tx.contentResultWeek.findUnique({
        where: { contentId_weekStart: { contentId, weekStart: day } },
        select: WEEK_SELECT,
      });
      await tx.contentResultWeek.upsert({
        where: { contentId_weekStart: { contentId, weekStart: day } },
        create: {
          contentId,
          weekStart: day,
          ...input,
          enteredById: actorUserId,
        },
        update: { ...input, enteredById: actorUserId },
      });
      const changes: Prisma.JsonObject = {};
      for (const field of CONTENT_RESULT_FIELDS)
        if ((before?.[field] ?? null) !== input[field])
          changes[field] = { from: before?.[field] ?? null, to: input[field] };
      await tx.auditLog.create({
        data: {
          userId: actorUserId,
          action: "content_result_week.saved",
          entityType: "ContentItem",
          entityId: contentId,
          metadata: { weekStart, changes },
        },
      });
    });
  }

  /** The items sent in the range, with their weeks (for the summary). */
  async sentBetween(start: Date, end: Date): Promise<SummaryItem[]> {
    const rows = await prisma.contentItem.findMany({
      where: { sentAt: { gte: start, lt: end }, state: "SENT" },
      select: {
        id: true,
        title: true,
        channel: true,
        sentAt: true,
        resultWeeks: { select: WEEK_SELECT },
      },
    });
    return rows.flatMap((row) =>
      row.sentAt
        ? [
            {
              id: row.id,
              title: row.title,
              channel: row.channel,
              sentAt: row.sentAt,
              weeks: row.resultWeeks.map(values),
            },
          ]
        : [],
    );
  }
}
