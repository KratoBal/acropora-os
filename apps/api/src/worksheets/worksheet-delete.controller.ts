import { Controller, Delete, Get, Param } from "@nestjs/common";

import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { WorksheetDeleteService } from "./worksheet-delete.service.js";

/**
 * AZ ÖNÁLLÓ MUNKALAP VÉGLEGES TÖRLÉSE (a hibajegy-törlés 2. szelete; acrobot 55770). Külön fájl, hogy a `worksheets.controller.ts` útvonalaihoz ne nyúljon. Ugyanaz a jog, mint a jegyé
 * (`service.job.delete`: tulajdonos, admin). `GET :id/delete-preview` az ablakhoz, `DELETE :id` a törlés.
 */
@Controller("service/worksheets")
export class WorksheetDeleteController {
  constructor(private readonly service: WorksheetDeleteService) {}

  @Get(":id/delete-preview")
  @RequirePermissions(PERMISSIONS.SERVICE_JOB_DELETE)
  preview(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.preview(id, user);
  }

  @Delete(":id")
  @RequirePermissions(PERMISSIONS.SERVICE_JOB_DELETE)
  delete(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.delete(id, user);
  }
}
