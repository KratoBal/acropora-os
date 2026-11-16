import type {
  ContentCalendarEntry,
  ContentCalendarGapEvent,
  ContentCalendarGaps,
  ContentCalendarSlotStatus,
  ContentState,
  ContentTemplateRule,
} from "@acropora/types";

import { expectedSlots, templateKindOf } from "./calendar-slots.plan.js";

/**
 * THE GAP AND COLLISION SIGNALS (T5.5 S6, spec 3. and 8B). Pure: the feed of the next 14 days, the template, the slots
 * that exist, the Omnibus counts and the setting in; the signals out.
 *
 * WHAT TURNS THE SPEC RED: an event shown as covered while a slot is only an idea or a draft; a late slot (its day
 * passed) forgiven instead of missing; an approved announcement of a sale with an unknown Omnibus value shown as done
 * (a sale price cannot go out without it); two items on one channel and day flagged (the rule is MORE than two); the
 * newsletter rule firing while the frequency is not set.
 */

export interface SlotRow {
  id: string;
  calendarEventKey: string;
  templateRuleId: string;
  state: ContentState;
}

const DAY_MS = 86_400_000;
const between = (from: string, to: string) =>
  Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() -
      new Date(`${from}T00:00:00Z`).getTime()) /
      DAY_MS,
  );

export function slotStatus(
  state: ContentState | null,
): ContentCalendarSlotStatus {
  switch (state) {
    case null:
      return "NOT_OPENED";
    case "IDEA":
      return "IDEA";
    case "READY_TO_SEND":
    case "SCHEDULED":
      return "APPROVED";
    case "SENT":
      return "SENT";
    case "DISCARDED":
      return "DISCARDED";
    default:
      return "DRAFT";
  }
}

export function computeGaps(input: {
  queriedAt: string;
  from: string;
  to: string;
  today: string;
  entries: readonly ContentCalendarEntry[];
  rules: readonly ContentTemplateRule[];
  slots: readonly SlotRow[];
  /** Per sale event key: how many of its products have an unknown Omnibus value. */
  omnibusUnknown: ReadonlyMap<string, number>;
  newsletterMinDays: number | null;
}): ContentCalendarGaps {
  const byPair = new Map(
    input.slots.map((row) => [
      `${row.calendarEventKey}|${row.templateRuleId}`,
      row,
    ]),
  );
  const events = new Map<string, ContentCalendarGapEvent>();
  for (const slot of expectedSlots(input.entries, input.rules).slots) {
    const { entry } = slot;
    const omnibusUnknown = input.omnibusUnknown.get(entry.key) ?? 0;
    const event =
      events.get(entry.key) ??
      ({
        eventKey: entry.key,
        kind: templateKindOf(entry)!,
        title: entry.title,
        startsOn: entry.startsOn,
        endsOn: entry.endsOn,
        slots: [],
        omnibusUnknown,
        missing: false,
      } satisfies ContentCalendarGapEvent);
    const row = byPair.get(`${slot.eventKey}|${slot.ruleId}`) ?? null;
    const status = slotStatus(row?.state ?? null);
    const done =
      status === "SENT" ||
      status === "DISCARDED" ||
      (status === "APPROVED" && omnibusUnknown === 0);
    event.slots.push({
      ruleId: slot.ruleId,
      label: slot.rule.label,
      channel: slot.channel,
      plannedOn: slot.plannedOn,
      daysLeft: between(input.today, slot.plannedOn),
      status,
      contentId: row?.id ?? null,
      done,
    });
    event.missing ||= !done;
    events.set(entry.key, event);
  }

  const planned = input.entries.flatMap((entry) =>
    entry.kind === "CONTENT" && entry.state !== "DISCARDED"
      ? [
          {
            contentId: entry.contentId,
            title: entry.title,
            channel: entry.channel,
            day: entry.startsOn as string,
          },
        ]
      : [],
  );
  const perDayChannel = new Map<string, typeof planned>();
  for (const item of planned) {
    const key = `${item.day}|${item.channel}`;
    perDayChannel.set(key, [...(perDayChannel.get(key) ?? []), item]);
  }
  const collisions = [...perDayChannel.values()]
    .filter((items) => items.length > 2)
    .map((items) => ({
      day: items[0]!.day,
      channel: items[0]!.channel,
      items: items.map(({ contentId, title }) => ({ contentId, title })),
    }))
    .sort(
      (a, b) =>
        a.day.localeCompare(b.day) || a.channel.localeCompare(b.channel),
    );

  const tooClose: ContentCalendarGaps["newsletter"]["tooClose"] = [];
  if (input.newsletterMinDays !== null) {
    const letters = planned
      .filter((item) => item.channel === "NEWSLETTER")
      .sort(
        (a, b) =>
          a.day.localeCompare(b.day) || a.contentId.localeCompare(b.contentId),
      );
    for (let i = 1; i < letters.length; i += 1) {
      const days = between(letters[i - 1]!.day, letters[i]!.day);
      if (days < input.newsletterMinDays)
        tooClose.push({
          first: pick(letters[i - 1]!),
          second: pick(letters[i]!),
          days,
        });
    }
  }

  return {
    queriedAt: input.queriedAt,
    from: input.from,
    to: input.to,
    events: [...events.values()].sort(
      (a, b) =>
        Number(b.missing) - Number(a.missing) ||
        String(a.startsOn).localeCompare(String(b.startsOn)) ||
        a.title.localeCompare(b.title, "hu"),
    ),
    collisions,
    newsletter: { minDaysBetween: input.newsletterMinDays, tooClose },
  };
}

const pick = (item: { contentId: string; title: string; day: string }) => ({
  contentId: item.contentId,
  title: item.title,
  day: item.day,
});
