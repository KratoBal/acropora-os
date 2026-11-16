import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { ContentCalendarFeed } from "@acropora/types";

import { CalendarFeedRepository } from "./calendar-feed.repository.js";
import {
  contentEntry,
  eventEntry,
  livestockEntry,
  orderEntries,
  purchaseEntries,
  saleEntries,
} from "./calendar-feed.view.js";
import { calendarRange } from "./calendar-range.js";

export const CALENDAR_FEED_CLOCK = Symbol("CALENDAR_FEED_CLOCK");

/**
 * THE CONTENT CALENDAR FEED (T5.5 S1). Reads every source of the range at once, and a failure of ANY of them is the
 * 503 below, never a feed with that source missing: a calendar without the sales looks exactly like a month without a
 * sale (spec 8B, last point).
 */
@Injectable()
export class CalendarFeedService {
  private readonly logger = new Logger(CalendarFeedService.name);

  constructor(
    private readonly repository: CalendarFeedRepository,
    @Optional()
    @Inject(CALENDAR_FEED_CLOCK)
    private readonly clock?: () => Date,
  ) {}

  async feed(fromDay: string, toDay: string): Promise<ContentCalendarFeed> {
    const range = calendarRange(fromDay, toDay);
    if ("problem" in range) throw new BadRequestException(range.problem);
    const now = (this.clock ?? (() => new Date()))();
    try {
      const [content, livestock, purchaseLines, undated, sales, events] =
        await Promise.all([
          this.repository.content(range),
          this.repository.livestock(range),
          this.repository.purchaseLines(range),
          this.repository.undatedOpenOrders(),
          this.repository.sales(range),
          this.repository.events(range),
        ]);
      return {
        queriedAt: now.toISOString(),
        from: range.fromDay,
        to: range.toDay,
        entries: orderEntries([
          ...content.map(contentEntry),
          ...livestock.map(livestockEntry),
          ...purchaseEntries(purchaseLines),
          ...saleEntries(sales),
          ...events.map(eventEntry),
        ]),
        withoutDay: { purchaseOrders: undated },
      };
    } catch (error) {
      this.logger.error(
        "A tartalomnaptár olvasása elbukott",
        error instanceof Error ? error.stack : String(error),
      );
      throw new ServiceUnavailableException(
        "A naptár adatai most nem olvashatók. Ez HIBA, nem üres naptár: nem jelenti, hogy nincs esemény, akció vagy érkezés.",
      );
    }
  }
}
