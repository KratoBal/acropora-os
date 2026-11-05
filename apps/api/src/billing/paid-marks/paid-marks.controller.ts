import { Controller, Get, HttpCode, Post } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { PaidMarkRunRepository } from "./paid-mark-run.repository.js";
import { PaidMarksAutoScheduler } from "./paid-marks-auto.scheduler.js";

/**
 * THE LATEST AUTOMATIC PAID-MARK RUN PER SOURCE (acrobot 26101): what was
 * written, and what needs a person. The dashboard's "Figyelmet igényel" tile
 * (planned in the dashboard batch, `attention`) reads the `attention` items.
 */
@Controller("billing/paid-marks")
export class PaidMarksController {
  constructor(
    private readonly runs: PaidMarkRunRepository,
    private readonly scheduler: PaidMarksAutoScheduler,
  ) {}

  @Get("latest")
  @RequirePermissions(PERMISSIONS.FINANCE_VIEW)
  latest() {
    return this.runs.latest();
  }

  /** Each source's switch and whether a run is in flight (e64540fd). */
  @Get("status")
  @RequirePermissions(PERMISSIONS.FINANCE_VIEW)
  status() {
    return { ...this.scheduler.status(), sources: this.scheduler.modes() };
  }

  /**
   * "FUTTATÁS MOST" (Balázs, 2026-11-05; e64540fd): the daily run by hand, with the same code and the
   * same switches. The right is the one that marks a bank transfer paid by hand (`BILLING_ISSUE`, the
   * pairing's write). 202: started; the outcome lands in `latest`. A run in flight answers `running`.
   */
  @Post("run")
  @HttpCode(202)
  @RequirePermissions(PERMISSIONS.BILLING_ISSUE)
  run(@CurrentUser() user: AuthenticatedUser) {
    return this.scheduler.runNow(user.id);
  }
}
