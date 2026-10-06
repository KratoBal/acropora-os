import { Controller, Get } from "@nestjs/common";
import {
  PERMISSIONS,
  hasPermission,
  type AuthenticatedUser,
  type NavigationCounters,
} from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { MaterialRequestsService } from "../material-requests/material-requests.service.js";
import { ServiceJobsService } from "../service-jobs/service-jobs.service.js";
import { WorksheetsService } from "../worksheets/worksheets.service.js";

/**
 * THE MENU NUMBERS FOR HIBAJEGYEK, MUNKALAPOK AND ANYAGIGÉNYEK (card
 * 4a6813db, Balázs 2026-10-05 22:10 UTC). One call for the web menu and the
 * mobile tiles.
 *
 * Each number is counted by the module's own service, with the module's own
 * visibility, so it cannot count what the list would not show. A number the
 * user's menu does not offer comes back `null`, checked with the same
 * permission the navigation registry uses for the entry.
 */
@Controller("navigation/counters")
export class NavigationCountersController {
  constructor(
    private readonly serviceJobs: ServiceJobsService,
    private readonly worksheets: WorksheetsService,
    private readonly materialRequests: MaterialRequestsService,
  ) {}

  @Get()
  async counters(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<NavigationCounters> {
    const serviceView = hasPermission(user, PERMISSIONS.SERVICE_VIEW);
    const [serviceJobs, worksheets, materialRequests] = await Promise.all([
      serviceView ? this.serviceJobs.navigationCount(user) : null,
      serviceView ? this.worksheets.navigationCount(user) : null,
      hasPermission(user, PERMISSIONS.SERVICE_MANAGE)
        ? this.materialRequests.navigationCount(user)
        : null,
    ]);
    return {
      "service-jobs": serviceJobs,
      worksheets,
      "material-requests-pending": materialRequests,
    };
  }
}
