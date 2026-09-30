import { Controller, Get, Param, Post } from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";

import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { ExpectedArrivalIntakeService } from "./expected-arrival-intake.service.js";
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
  list() {
    return this.arrivals.list();
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
}
