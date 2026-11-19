import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import {
  LinkableWorksheetsQueryDto,
  LinkWorksheetDto,
} from "./service-job-linked-worksheets.dto.js";
import { ServiceJobLinkedWorksheetsService } from "./service-job-linked-worksheets.service.js";

/**
 * THE WORKSHEETS LINKED TO A MAINTENANCE SHEET (card 5b366f5d). A separate controller so the attach routes of
 * `service-jobs.controller.ts` (which the maintenance guard blocks on purpose: a move would change the worksheet's place)
 * stay untouched: a link is another operation with another meaning. Reading: `service.view`; writing: `service.manage`, and
 * the service answers 404 to anyone who is not internal.
 */
@Controller("service/jobs")
export class ServiceJobLinkedWorksheetsController {
  constructor(private readonly service: ServiceJobLinkedWorksheetsService) {}

  @Get(":id/linked-worksheets")
  @RequirePermissions(PERMISSIONS.SERVICE_VIEW)
  list(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.list(id, user);
  }

  @Get(":id/linkable-worksheets")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  linkable(
    @Param("id") id: string,
    @Query() query: LinkableWorksheetsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.linkable(id, query, user);
  }

  @Post(":id/linked-worksheets")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  link(
    @Param("id") id: string,
    @Body() input: LinkWorksheetDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.link(id, input.worksheetId, user);
  }

  @Delete(":id/linked-worksheets/:worksheetId")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  unlink(
    @Param("id") id: string,
    @Param("worksheetId") worksheetId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.unlink(id, worksheetId, user);
  }
}
