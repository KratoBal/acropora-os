import { Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { ExpectedArrivalIntakeService } from "./expected-arrival-intake.service.js";
import { ExpectedArrivalListQueryDto } from "./expected-arrival-list-query.dto.js";
import { ExpectedArrivalService } from "./expected-arrival.service.js";

/**
 * VÁRHATÓ BEÉRKEZÉSEK: the list (mail and NAV), one arrival for the editor,
 * the mail pull's state, and a manual run.
 */
@Controller("purchasing/expected-arrivals")
export class ExpectedArrivalController {
  constructor(
    private readonly intake: ExpectedArrivalIntakeService,
    private readonly arrivals: ExpectedArrivalService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PURCHASING_VIEW)
  list(@Query() query: ExpectedArrivalListQueryDto) {
    return this.arrivals.list(query);
  }

  @Get("sync")
  @RequirePermissions(PERMISSIONS.PURCHASING_VIEW)
  status() {
    return this.intake.status();
  }

  @Post("sync")
  @RequirePermissions(PERMISSIONS.PURCHASING_MANAGE)
  sync() {
    return this.intake.sync("MANUAL");
  }

  // After "sync": a literal route first, then the parameter.
  @Get(":id")
  @RequirePermissions(PERMISSIONS.PURCHASING_VIEW)
  detail(@Param("id") id: string) {
    return this.arrivals.detail(id);
  }

  /** "Nem kell": the arrival leaves the list, audited; `restore` undoes it. */
  @Post(":id/dismiss")
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.PURCHASING_MANAGE)
  dismiss(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.arrivals.dismiss(id, user.id);
  }

  @Post(":id/restore")
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.PURCHASING_MANAGE)
  restore(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.arrivals.restore(id, user.id);
  }
}
