import { Injectable } from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";

import { startOfBudapestDay } from "../../dashboard/budapest-day.js";
import type { SlotPlan } from "./calendar-slots.plan.js";

// "|" is in neither: an event key is "<kind>:<id>[:<day>]", a rule id a cuid or "t55-..."
const pairKey = (eventKey: string, ruleId: string) => `${eventKey}|${ruleId}`;

/** The planned instant of a Budapest day: 10:00 there, so the day reads the same in both seasons. */
export function plannedInstant(day: string): Date {
  const start = startOfBudapestDay(new Date(`${day}T12:00:00Z`));
  return new Date(start.getTime() + 10 * 3_600_000);
}

/**
 * THE CONTENT SLOTS (T5.5 S5). A slot is an ordinary content item in IDEA state, with no author: the calendar opened
 * it, nobody wrote it yet. Its first log line names who opened it and from which template row. The unique index on
 * (event, row) is what makes opening repeatable: a slot that exists is skipped, and one opened in between by a second
 * call is a unique violation counted as existing, not an error.
 */
@Injectable()
export class CalendarSlotsRepository {
  /** The (event, row) pairs that already have a slot, among the ones asked about. */
  async existing(slots: readonly SlotPlan[]): Promise<Set<string>> {
    if (slots.length === 0) return new Set();
    const rows = await prisma.contentItem.findMany({
      where: {
        calendarEventKey: { in: [...new Set(slots.map((s) => s.eventKey))] },
        templateRuleId: { in: [...new Set(slots.map((s) => s.ruleId))] },
      },
      select: { calendarEventKey: true, templateRuleId: true },
    });
    return new Set(
      rows.map((row) => pairKey(row.calendarEventKey!, row.templateRuleId!)),
    );
  }

  static has(existing: Set<string>, slot: SlotPlan): boolean {
    return existing.has(pairKey(slot.eventKey, slot.ruleId));
  }

  /** The new item's id, or "existing" when a slot for the pair appeared since `existing` was read. */
  async open(
    slot: SlotPlan,
    ruleLabel: string,
    actorUserId: string,
  ): Promise<string | "existing"> {
    try {
      const row = await prisma.contentItem.create({
        data: {
          title: slot.title,
          channel: slot.channel,
          state: "IDEA",
          plannedFor: plannedInstant(slot.plannedOn),
          calendarEventKey: slot.eventKey,
          templateRuleId: slot.ruleId,
          stateEvents: {
            create: {
              fromState: null,
              toState: "IDEA",
              actorUserId,
              note: `Tartalomnaptár: a „${ruleLabel}” sablon-sor nyitotta.`,
            },
          },
        },
        select: { id: true },
      });
      return row.id;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        return "existing";
      throw error;
    }
  }
}
