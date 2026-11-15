import { Injectable } from "@nestjs/common";
import { prisma } from "@acropora/database";
import type { ContentCalendarSettings } from "@acropora/types";

import type { SlotRow } from "./calendar-gaps.js";

/** The one settings row's id (the RentalSetting pattern). */
export const CONTENT_CALENDAR_SETTING_ID = "content-calendar";

/** The slots of the asked events, and the calendar's one settings row. */
@Injectable()
export class CalendarGapsRepository {
  async slots(eventKeys: readonly string[]): Promise<SlotRow[]> {
    if (eventKeys.length === 0) return [];
    const rows = await prisma.contentItem.findMany({
      where: {
        calendarEventKey: { in: [...new Set(eventKeys)] },
        templateRuleId: { not: null },
      },
      select: {
        id: true,
        calendarEventKey: true,
        templateRuleId: true,
        state: true,
      },
    });
    return rows.flatMap((row) =>
      row.calendarEventKey && row.templateRuleId
        ? [
            {
              id: row.id,
              calendarEventKey: row.calendarEventKey,
              templateRuleId: row.templateRuleId,
              state: row.state,
            },
          ]
        : [],
    );
  }

  async settings(): Promise<ContentCalendarSettings> {
    const row = await prisma.contentCalendarSetting.findUnique({
      where: { id: CONTENT_CALENDAR_SETTING_ID },
      select: { newsletterMinDays: true, updatedAt: true },
    });
    return {
      newsletterMinDays: row?.newsletterMinDays ?? null,
      updatedAt: row?.updatedAt.toISOString() ?? null,
    };
  }

  /** The setting and its audit line, together; the line says what it was and what it became. */
  async saveSettings(
    newsletterMinDays: number | null,
    actorUserId: string,
  ): Promise<ContentCalendarSettings> {
    return prisma.$transaction(async (tx) => {
      const before = await tx.contentCalendarSetting.findUnique({
        where: { id: CONTENT_CALENDAR_SETTING_ID },
        select: { newsletterMinDays: true },
      });
      const row = await tx.contentCalendarSetting.upsert({
        where: { id: CONTENT_CALENDAR_SETTING_ID },
        create: {
          id: CONTENT_CALENDAR_SETTING_ID,
          newsletterMinDays,
          updatedById: actorUserId,
        },
        update: { newsletterMinDays, updatedById: actorUserId },
        select: { newsletterMinDays: true, updatedAt: true },
      });
      await tx.auditLog.create({
        data: {
          userId: actorUserId,
          action: "content_calendar_setting.updated",
          entityType: "ContentCalendarSetting",
          entityId: CONTENT_CALENDAR_SETTING_ID,
          metadata: {
            newsletterMinDays: {
              from: before?.newsletterMinDays ?? null,
              to: newsletterMinDays,
            },
          },
        },
      });
      return {
        newsletterMinDays: row.newsletterMinDays,
        updatedAt: row.updatedAt.toISOString(),
      };
    });
  }
}
