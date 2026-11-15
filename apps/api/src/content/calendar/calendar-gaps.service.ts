import {
  ForbiddenException,
  Inject,
  Injectable,
  Optional,
} from "@nestjs/common";
import {
  CONTENT_CALENDAR_GAP_DAYS,
  CONTENT_CALENDAR_UNKNOWN,
  isMachineRole,
  type ContentCalendarEntry,
  type ContentCalendarGaps,
  type ContentCalendarSettings,
} from "@acropora/types";

import { budapestDayKey } from "../../dashboard/budapest-day.js";
import { ProductDataService } from "../product-data/product-data.service.js";
import { UNKNOWN } from "../product-data/product-data.types.js";
import type { CalendarEventActor } from "./calendar-event.service.js";
import {
  CALENDAR_FEED_CLOCK,
  CalendarFeedService,
} from "./calendar-feed.service.js";
import { computeGaps } from "./calendar-gaps.js";
import { CalendarGapsRepository } from "./calendar-gaps.repository.js";
import { addDays } from "./calendar-slots.plan.js";
import { ContentTemplateRepository } from "./content-template.repository.js";

const MACHINE =
  "A tartalomnaptár beállítását ember módosítja: gépi fiók nem írhatja.";
/** One product-data read names at most this many products (the reader's own limit). */
const OMNIBUS_BATCH = 100;

/** A sale whose window holds today: the only kind with an Omnibus reference to check (T5.4 computes it for those). */
function runningSale(entry: ContentCalendarEntry, today: string): boolean {
  if (entry.kind !== "SALE") return false;
  const started =
    entry.startsOn === CONTENT_CALENDAR_UNKNOWN || entry.startsOn <= today;
  const notEnded =
    entry.endsOn === null ||
    entry.endsOn === CONTENT_CALENDAR_UNKNOWN ||
    entry.endsOn >= today;
  return started && notEnded;
}

/**
 * THE GAP AND COLLISION SIGNALS (T5.5 S6, spec 3.): the next 14 days from the same feed as the calendar, the template,
 * the slots, the Omnibus values of the running sales (the T5.4 reader, server-side, spec 8D) and the newsletter
 * frequency. Any failed read is the feed's or the reader's 503: a gap list that silently lacks the sales would read as
 * "nothing missing".
 */
@Injectable()
export class CalendarGapsService {
  constructor(
    private readonly feed: CalendarFeedService,
    private readonly templates: ContentTemplateRepository,
    private readonly repository: CalendarGapsRepository,
    private readonly productData: ProductDataService,
    @Optional()
    @Inject(CALENDAR_FEED_CLOCK)
    private readonly clock?: () => Date,
  ) {}

  async gaps(): Promise<ContentCalendarGaps> {
    const today = budapestDayKey((this.clock ?? (() => new Date()))());
    const to = addDays(today, CONTENT_CALENDAR_GAP_DAYS - 1);
    const [feed, rules, settings] = await Promise.all([
      this.feed.feed(today, to),
      this.templates.list(),
      this.repository.settings(),
    ]);
    const events = feed.entries.filter((entry) => entry.kind !== "CONTENT");
    const [slots, omnibusUnknown] = await Promise.all([
      this.repository.slots(events.map((entry) => entry.key)),
      this.omnibusUnknown(events.filter((entry) => runningSale(entry, today))),
    ]);
    return computeGaps({
      queriedAt: feed.queriedAt,
      from: feed.from,
      to: feed.to,
      today,
      entries: feed.entries,
      rules,
      slots,
      omnibusUnknown,
      newsletterMinDays: settings.newsletterMinDays,
    });
  }

  settings(): Promise<ContentCalendarSettings> {
    return this.repository.settings();
  }

  saveSettings(
    newsletterMinDays: number | null,
    actor: CalendarEventActor,
  ): Promise<ContentCalendarSettings> {
    if (isMachineRole(actor.role)) throw new ForbiddenException(MACHINE);
    return this.repository.saveSettings(newsletterMinDays, actor.id);
  }

  /** Per running sale: how many of its products have a variant whose Omnibus value is unknown. */
  private async omnibusUnknown(
    sales: readonly ContentCalendarEntry[],
  ): Promise<Map<string, number>> {
    const ids = [
      ...new Set(
        sales.flatMap((entry) =>
          entry.kind === "SALE" ? entry.products.map((p) => p.id) : [],
        ),
      ),
    ];
    const unknown = new Set<string>();
    for (let i = 0; i < ids.length; i += OMNIBUS_BATCH) {
      const batch = ids.slice(i, i + OMNIBUS_BATCH);
      const answer = await this.productData.read({
        query: { identifiers: batch },
        limit: OMNIBUS_BATCH,
        offset: 0,
      });
      for (const product of answer.products)
        if (
          product.variants.some(
            (variant) =>
              variant.price.status !== UNKNOWN &&
              variant.price.sale?.state === "fut" &&
              variant.price.omnibus.status === UNKNOWN,
          )
        )
          unknown.add(product.id);
    }
    return new Map(
      sales.map((entry) => [
        entry.key,
        entry.kind === "SALE"
          ? entry.products.filter((p) => unknown.has(p.id)).length
          : 0,
      ]),
    );
  }
}
