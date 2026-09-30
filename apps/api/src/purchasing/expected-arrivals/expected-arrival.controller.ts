import { Controller, Get, Post } from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";

import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { ExpectedArrivalIntakeService } from "./expected-arrival-intake.service.js";

/**
 * VÁRHATÓ BEÉRKEZÉSEK. This part: the mail pull's state, and a manual run
 * (stage measurements, and the page's "check now"). The list and the
 * editor's prefill come in the next part.
 */
@Controller("purchasing/expected-arrivals")
export class ExpectedArrivalController {
  constructor(private readonly intake: ExpectedArrivalIntakeService) {}

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
}
