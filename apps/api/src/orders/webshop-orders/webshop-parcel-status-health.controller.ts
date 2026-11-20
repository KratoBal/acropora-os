import { Controller, Get } from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";

import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import {
  WebshopParcelStatusScheduler,
  type ParcelSyncStatus,
} from "./webshop-parcel-status.scheduler.js";

/**
 * THE PARCEL STATUS SYNC'S STATE, READ ONLY (card ef84489d, acrobot 56760). The run's report went only to the application log, which the
 * fleet cannot read on the test API, so the observe mode (the Foxpost delivered codes are not known yet) could not be measured. Numbers,
 * short status codes and times: no order identifier, name, address or secret; it reads nothing and starts nothing (the run writes its
 * report to memory; a restart forgets it). Behind the same permission as the projection's status (`health/medusa-projection`), not public.
 */
@Controller("health/parcel-status-sync")
export class WebshopParcelStatusHealthController {
  constructor(private readonly scheduler: WebshopParcelStatusScheduler) {}

  @Get()
  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  status(): ParcelSyncStatus {
    return this.scheduler.allapot();
  }
}
