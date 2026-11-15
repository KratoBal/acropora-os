import { prisma } from "@acropora/database";
import type { ContentState, ContentTemplateAnchor } from "@acropora/types";

import { budapestDayKey } from "../../dashboard/budapest-day.js";
import { addDays } from "./calendar-slots.plan.js";
import { plannedInstant } from "./calendar-slots.repository.js";

/**
 * AN EVENT'S CHANGE REACHES ITS CONTENT (T5.5 S7, spec 5.: "egy esemény módosítása értesíti a hozzákapcsolt tartalmak
 * szerzőjét, és az érintett tételek visszalépnek jóváhagyásra vár állapotba, mert a szövegben szereplő dátum már nem igaz").
 *
 * WHICH EVENTS: the ones whose key does not change with their day, the hand-entered event (`event:<id>`) and the live
 * arrival (`livestock:<id>`). A sale's key is its window and a purchase's its day: a moved one is a NEW key, and its old
 * slots are not found from here (said in the PR; the gap list is where they can be flagged).
 *
 * WHAT HAPPENS TO A SLOT (an item the template opened for the event, not sent, not discarded):
 * - its planned day follows the event (the row's anchor and offset on the new days);
 * - an approved one (`READY_TO_SEND`) steps back to `AWAITING_APPROVAL`, its log line naming the reason. A system step,
 *   outside the people's transitions: nobody chose it, the event moved under the text;
 * - a `SCHEDULED` one keeps its state: it is scheduled on the outside channel for the OLD day, and a state change here
 *   would not move that. The comment says it has to be rescheduled by hand;
 * - every touched item gets a comment that says what moved: the in-OS notice to its author (content has no push
 *   notification, Balázs's T5.1 decision: "csak az OS-ben").
 * An event that is gone (deleted, or an arrival cancelled) moves nothing; its approved slots step back, and every slot is
 * told.
 */

export interface FollowedEvent {
  title: string;
  startsOn: string;
  endsOn: string;
}

export interface FollowSlot {
  id: string;
  state: ContentState;
  plannedFor: Date | null;
  anchor: ContentTemplateAnchor;
  offsetDays: number;
}

export interface FollowStep {
  id: string;
  /** The new planned day, or null when it stays. */
  plannedOn: string | null;
  stepBack: boolean;
  comment: string;
}

const day = (at: Date | null) => (at ? budapestDayKey(at) : null);

/** What each slot needs; pure. A slot whose day does not change and whose event is still there needs nothing. */
export function followPlan(
  slots: readonly FollowSlot[],
  event: FollowedEvent | null,
  eventTitle: string,
): FollowStep[] {
  const steps: FollowStep[] = [];
  for (const slot of slots) {
    if (slot.state === "SENT" || slot.state === "DISCARDED") continue;
    const stepBack = slot.state === "READY_TO_SEND";
    const scheduled = slot.state === "SCHEDULED";
    if (!event) {
      steps.push({
        id: slot.id,
        plannedOn: null,
        stepBack,
        comment: `Az esemény („${eventTitle}”) megszűnt: törölték vagy lemondták.${
          stepBack ? " A tétel ezért visszalépett jóváhagyásra." : ""
        }${scheduled ? " A tétel ütemezve van: az ütemezést kézzel kell visszavonni." : ""}`,
      });
      continue;
    }
    const anchor = slot.anchor === "END" ? event.endsOn : event.startsOn;
    const plannedOn = addDays(anchor, slot.offsetDays);
    const before = day(slot.plannedFor);
    if (before === plannedOn) continue;
    steps.push({
      id: slot.id,
      plannedOn,
      stepBack,
      comment: `Az esemény („${event.title}”) napja megváltozott: a tervezett nap ${before ?? "nem volt"} helyett ${plannedOn}.${
        stepBack
          ? " A tétel ezért visszalépett jóváhagyásra: a szövegben álló dátum már nem igaz."
          : ""
      }${scheduled ? " A tétel a régi napra van ütemezve: az ütemezést kézzel kell átírni." : ""}`,
    });
  }
  return steps;
}

/**
 * Applies `followPlan` to the event's slots, each item in its own conditional write: an item that moved on since it was
 * read (approved, sent, discarded by someone in between) is left alone, never overwritten. Returns how many changed.
 */
export async function followCalendarEvent(input: {
  eventKey: string;
  eventTitle: string;
  event: FollowedEvent | null;
  actorUserId: string | null;
}): Promise<{ moved: number; steppedBack: number; told: number }> {
  const rows = await prisma.contentItem.findMany({
    where: {
      calendarEventKey: input.eventKey,
      templateRuleId: { not: null },
      state: { notIn: ["SENT", "DISCARDED"] },
    },
    select: {
      id: true,
      state: true,
      plannedFor: true,
      templateRule: { select: { anchor: true, offsetDays: true } },
    },
  });
  const slots: FollowSlot[] = rows.flatMap((row) =>
    row.templateRule
      ? [
          {
            id: row.id,
            state: row.state,
            plannedFor: row.plannedFor,
            anchor: row.templateRule.anchor,
            offsetDays: row.templateRule.offsetDays,
          },
        ]
      : [],
  );
  const result = { moved: 0, steppedBack: 0, told: 0 };
  const stateOf = new Map(slots.map((slot) => [slot.id, slot.state]));
  for (const step of followPlan(slots, input.event, input.eventTitle)) {
    const from = stateOf.get(step.id)!;
    const changed = await prisma.$transaction(async (tx) => {
      const { count } = await tx.contentItem.updateMany({
        where: { id: step.id, state: from },
        data: {
          ...(step.plannedOn
            ? { plannedFor: plannedInstant(step.plannedOn) }
            : {}),
          ...(step.stepBack ? { state: "AWAITING_APPROVAL" as const } : {}),
        },
      });
      if (count !== 1) return false;
      if (step.stepBack)
        await tx.contentStateEvent.create({
          data: {
            contentId: step.id,
            fromState: from,
            toState: "AWAITING_APPROVAL",
            actorUserId: input.actorUserId,
            note: "A naptár-esemény változott: a szövegben álló dátum már nem igaz.",
          },
        });
      await tx.contentComment.create({
        data: {
          contentId: step.id,
          authorId: input.actorUserId,
          body: step.comment,
        },
      });
      return true;
    });
    if (!changed) continue;
    result.told += 1;
    if (step.plannedOn) result.moved += 1;
    if (step.stepBack) result.steppedBack += 1;
  }
  return result;
}
