import { Body, Controller, Get, Put } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { ContentCalendarSettingsDto } from "./calendar-gaps.dto.js";
import { CalendarGapsService } from "./calendar-gaps.service.js";

/**
 * THE CALENDAR'S GAP SIGNALS AND ITS SETTING (T5.5 S6). Reading is `content.view`; the setting is written behind
 * `content.manage` by a person (the service refuses a machine account).
 */
@Controller("content/calendar")
export class CalendarGapsController {
  constructor(private readonly service: CalendarGapsService) {}

  @Get("gaps")
  @RequirePermissions(PERMISSIONS.CONTENT_VIEW)
  gaps() {
    return this.service.gaps();
  }

  @Get("settings")
  @RequirePermissions(PERMISSIONS.CONTENT_VIEW)
  settings() {
    return this.service.settings();
  }

  @Put("settings")
  @RequirePermissions(PERMISSIONS.CONTENT_MANAGE)
  saveSettings(
    @Body() input: ContentCalendarSettingsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.saveSettings(input.newsletterMinDays, user);
  }
}
