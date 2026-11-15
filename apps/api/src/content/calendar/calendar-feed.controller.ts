import { Controller, Get, Query } from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";

import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { ContentCalendarFeedQueryDto } from "./calendar-feed.dto.js";
import { CalendarFeedService } from "./calendar-feed.service.js";

/**
 * THE CONTENT CALENDAR FEED (T5.5 S1): read-only, for the people who plan content. Its own path segment under
 * `content/calendar`, so it never meets `content/:id`.
 */
@Controller("content/calendar")
export class CalendarFeedController {
  constructor(private readonly service: CalendarFeedService) {}

  @Get("feed")
  @RequirePermissions(PERMISSIONS.CONTENT_VIEW)
  feed(@Query() query: ContentCalendarFeedQueryDto) {
    return this.service.feed(query.from, query.to);
  }
}
