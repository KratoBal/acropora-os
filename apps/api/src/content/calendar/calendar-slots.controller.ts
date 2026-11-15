import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { ContentCalendarFeedQueryDto } from "./calendar-feed.dto.js";
import { CalendarSlotsService } from "./calendar-slots.service.js";

/**
 * OPENING THE CONTENT SLOTS OF A RANGE (T5.5 S5): `content.manage`, a person (the service refuses a machine account).
 * The body is the same two days as the feed's query; the range selects the events whose slots are opened.
 */
@Controller("content/calendar/slots")
export class CalendarSlotsController {
  constructor(private readonly service: CalendarSlotsService) {}

  @Post("open")
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.CONTENT_MANAGE)
  open(
    @Body() range: ContentCalendarFeedQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.open(range.from, range.to, user);
  }
}
