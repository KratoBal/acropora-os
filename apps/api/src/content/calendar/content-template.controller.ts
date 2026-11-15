import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";

import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import {
  CreateContentTemplateRuleDto,
  UpdateContentTemplateRuleDto,
} from "./content-template.dto.js";
import { ContentTemplateService } from "./content-template.service.js";

/**
 * THE CONTENT CALENDAR'S DEPENDENCY TEMPLATE (T5.5 S4). Reading is `content.view`, writing `content.manage` (a machine
 * account is refused by the service). No DELETE: a row is switched off with `active: false`.
 */
@Controller("content/calendar/template")
export class ContentTemplateController {
  constructor(private readonly service: ContentTemplateService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CONTENT_VIEW)
  list() {
    return this.service.list();
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CONTENT_MANAGE)
  create(
    @Body() input: CreateContentTemplateRuleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(input, user);
  }

  @Patch(":id")
  @RequirePermissions(PERMISSIONS.CONTENT_MANAGE)
  update(
    @Param("id") id: string,
    @Body() input: UpdateContentTemplateRuleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(id, input, user);
  }
}
