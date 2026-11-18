import { Controller, Delete, Get, Param } from "@nestjs/common";

import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { ServiceJobDeleteService } from "./service-job-delete.service.js";

/**
 * A HIBAJEGY VÉGLEGES TÖRLÉSE (acrobot 55766, 55770). Külön fájl, hogy a `service-jobs.controller.ts` útvonalaihoz ne nyúljon. A jog szigorúbb a szerviz-kezelésnél: `service.job.delete`
 * (tulajdonos és admin; a menedzser nem). `GET :id/delete-preview` az ablakhoz, `DELETE :id` maga a törlés.
 */
@Controller("service/jobs")
export class ServiceJobDeleteController {
  constructor(private readonly service: ServiceJobDeleteService) {}

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
