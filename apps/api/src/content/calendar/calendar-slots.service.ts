import {
  ForbiddenException,
  Inject,
  Injectable,
  Optional,
} from "@nestjs/common";
import {
  isMachineRole,
  type ContentCalendarSlotsResult,
} from "@acropora/types";

import { budapestDayKey } from "../../dashboard/budapest-day.js";
import type { CalendarEventActor } from "./calendar-event.service.js";
import {
  CALENDAR_FEED_CLOCK,
  CalendarFeedService,
} from "./calendar-feed.service.js";
import { planSlots } from "./calendar-slots.plan.js";
import { CalendarSlotsRepository } from "./calendar-slots.repository.js";
import { ContentTemplateRepository } from "./content-template.repository.js";

const MACHINE =
  "A tartalom-helyeket ember nyitja: gépi fiók nem nyithat helyet a naptárból.";

/**
 * OPENING THE CONTENT SLOTS OF A RANGE (T5.5 S5, plan S5, spec 2.): the feed of the range, the active template rows,
 * and one IDEA item per (event, row) that has none yet. Repeatable: a second call opens nothing new. It reads the same
 * feed as the calendar, so a failed source is the feed's 503 here too, never a run that silently opens fewer slots.
 * Nothing is sent anywhere (spec 5.): a slot is an idea with a day.
 *
 * A machine account does not open slots: the calendar's writes are a person's (acrobot 53159).
 */
@Injectable()
export class CalendarSlotsService {
  constructor(
    private readonly feed: CalendarFeedService,
    private readonly templates: ContentTemplateRepository,
    private readonly repository: CalendarSlotsRepository,
    @Optional()
    @Inject(CALENDAR_FEED_CLOCK)
    private readonly clock?: () => Date,
  ) {}

  async open(
    from: string,
    to: string,
    actor: CalendarEventActor,
  ): Promise<ContentCalendarSlotsResult> {
    if (isMachineRole(actor.role)) throw new ForbiddenException(MACHINE);
    const [feed, rules] = await Promise.all([
      this.feed.feed(from, to),
      this.templates.list(),
    ]);
    const today = budapestDayKey((this.clock ?? (() => new Date()))());
    const { slots, skipped } = planSlots(feed.entries, rules, today);
    const labels = new Map(rules.map((rule) => [rule.id, rule.label]));
    const existing = await this.repository.existing(slots);
    const result: ContentCalendarSlotsResult = {
      from: feed.from,
      to: feed.to,
      opened: [],
      existing: 0,
      skipped,
    };
    for (const slot of slots) {
      const id = CalendarSlotsRepository.has(existing, slot)
        ? "existing"
        : await this.repository.open(
            slot,
            labels.get(slot.ruleId) ?? "",
            actor.id,
          );
      if (id === "existing") result.existing += 1;
      else
        result.opened.push({
          contentId: id,
          title: slot.title,
          plannedOn: slot.plannedOn,
        });
    }
    return result;
  }
}
