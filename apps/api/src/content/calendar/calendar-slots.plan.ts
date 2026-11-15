import {
  CONTENT_CALENDAR_UNKNOWN,
  type ContentCalendarEntry,
  type ContentCalendarSlotsResult,
  type ContentChannel,
  type ContentTemplateEventKind,
  type ContentTemplateRule,
} from "@acropora/types";

/**
 * WHICH SLOTS A RANGE NEEDS (T5.5 S5). Pure: the feed's entries, the template's rows and today in, the slots to open
 * and the rows that open nothing (with the reason) out. The repository then skips what exists.
 *
 * WHAT TURNS THE SPEC RED: a last-day reminder opened for an open-ended sale (it has no last day, spec 8B); a slot
 * guessed for a sale whose start the mirror does not know; a slot opened for a day already past; a switched-off row
 * opening anything; the content items themselves treated as events.
 */
export interface SlotPlan {
  eventKey: string;
  ruleId: string;
  title: string;
  channel: ContentChannel;
  /** The Budapest day the content is planned for. */
  plannedOn: string;
}

const DAY_MS = 86_400_000;
export const addDays = (day: string, days: number) =>
  new Date(new Date(`${day}T00:00:00Z`).getTime() + days * DAY_MS)
    .toISOString()
    .slice(0, 10);

/** The template's event kind of a feed entry; the content items are not events. */
export function templateKindOf(
  entry: ContentCalendarEntry,
): ContentTemplateEventKind | null {
  switch (entry.kind) {
    case "EVENT":
      return entry.eventKind;
    case "LIVESTOCK_ARRIVAL":
    case "PURCHASE_ARRIVAL":
    case "SALE":
      return entry.kind;
    case "CONTENT":
      return null;
  }
}

/**
 * THE SLOTS THE TEMPLATE EXPECTS for the entries, whatever their day: what S5 opens (minus the past days) and what S6
 * checks (a past day counts there: a late slot is missing, not forgiven). Rows that cannot have a day are counted.
 */
export function expectedSlots(
  entries: readonly ContentCalendarEntry[],
  rules: readonly ContentTemplateRule[],
): {
  slots: (SlotPlan & {
    entry: ContentCalendarEntry;
    rule: ContentTemplateRule;
  })[];
  skipped: Omit<ContentCalendarSlotsResult["skipped"], "pastDay">;
} {
  const skipped = { openEnded: 0, unknownDay: 0 };
  const slots: (SlotPlan & {
    entry: ContentCalendarEntry;
    rule: ContentTemplateRule;
  })[] = [];
  for (const entry of entries) {
    const kind = templateKindOf(entry);
    if (!kind) continue;
    for (const rule of rules) {
      if (!rule.active || rule.eventKind !== kind) continue;
      const anchor = rule.anchor === "END" ? entry.endsOn : entry.startsOn;
      if (anchor === null) {
        skipped.openEnded += 1;
        continue;
      }
      if (anchor === CONTENT_CALENDAR_UNKNOWN) {
        skipped.unknownDay += 1;
        continue;
      }
      slots.push({
        eventKey: entry.key,
        ruleId: rule.id,
        title: `${rule.label}: ${entry.title}`,
        channel: rule.channel,
        plannedOn: addDays(anchor, rule.offsetDays),
        entry,
        rule,
      });
    }
  }
  return { slots, skipped };
}

/** What S5 opens: the expected slots whose day has not passed. */
export function planSlots(
  entries: readonly ContentCalendarEntry[],
  rules: readonly ContentTemplateRule[],
  today: string,
): { slots: SlotPlan[]; skipped: ContentCalendarSlotsResult["skipped"] } {
  const expected = expectedSlots(entries, rules);
  const slots: SlotPlan[] = [];
  let pastDay = 0;
  for (const slot of expected.slots) {
    if (slot.plannedOn < today) pastDay += 1;
    else
      slots.push({
        eventKey: slot.eventKey,
        ruleId: slot.ruleId,
        title: slot.title,
        channel: slot.channel,
        plannedOn: slot.plannedOn,
      });
  }
  return { slots, skipped: { pastDay, ...expected.skipped } };
}
