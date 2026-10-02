import { Controller, Get } from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";

import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { PaidMarkRunRepository } from "./paid-mark-run.repository.js";

/**
 * THE LATEST AUTOMATIC PAID-MARK RUN PER SOURCE (acrobot 26101): what was
 * written, and what needs a person. The dashboard's "Figyelmet igényel" tile
 * (planned in the dashboard batch, `attention`) reads the `attention` items.
 */
@Controller("billing/paid-marks")
export class PaidMarksController {
  constructor(private readonly runs: PaidMarkRunRepository) {}

  @Get("latest")
  @RequirePermissions(PERMISSIONS.FINANCE_VIEW)
  latest() {
    return this.runs.latest();
  }
}
