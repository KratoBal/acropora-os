import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from "@nestjs/common";

import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import {
  CreateCalendarEventDto,
  UpdateCalendarEventDto,
} from "./calendar-event.dto.js";
import { CalendarEventService } from "./calendar-event.service.js";

/**
 * THE HAND-ENTERED CALENDAR EVENTS (T5.5 S2). Reading is `content.view`, writing `content.manage`: the people who plan
 * the content keep the calendar (no new permission, so no new role decision). The list is the calendar feed itself
 * (`GET content/calendar/feed`), which carries every event of a range with its id; here is the one record for the edit
 * form. A delete is a real delete, and the audit log keeps what was there. A machine account (the content agent)
 * holds `content.manage` but the service refuses it every write here: it reads, a person writes.
 */
@Controller("content/calendar/events")
export class CalendarEventController {
  constructor(private readonly service: CalendarEventService) {}

  /** BEFORE `:id`: Nest matches in declaration order, and `options` would be taken for an id. */
  @Get("options/responsible")
  @RequirePermissions(PERMISSIONS.CONTENT_MANAGE)
  responsibleOptions() {
    return this.service.responsibleOptions();
  }

  @Get(":id")
  @RequirePermissions(PERMISSIONS.CONTENT_VIEW)
  get(@Param("id") id: string) {
    return this.service.get(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CONTENT_MANAGE)
  create(
    @Body() input: CreateCalendarEventDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(input, user);
  }

  @Patch(":id")
  @RequirePermissions(PERMISSIONS.CONTENT_MANAGE)
  update(
    @Param("id") id: string,
    @Body() input: UpdateCalendarEventDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(id, input, user);
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.CONTENT_MANAGE)
  delete(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.delete(id, user);
  }
}
