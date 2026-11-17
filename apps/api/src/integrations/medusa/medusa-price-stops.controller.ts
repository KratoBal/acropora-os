import { Controller, Get } from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";

import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import {
  MedusaPriceStopsService,
  type PriceStopsView,
} from "./medusa-price-stops.service.js";

/**
 * THE STORED PRICE STOPS, READ ONLY (task t-20261117-arstop-lista; acrobot 55208). The same permission as the projection queue status
 * (`health/medusa-projection`): the list names products and a price problem of each, which is the shop's business, not a public fact.
 * No write verb, no parameter: the list is what the sync stored.
 */
@Controller("health/medusa-price-stops")
export class MedusaPriceStopsController {
  constructor(private readonly service: MedusaPriceStopsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  list(): Promise<PriceStopsView> {
    return this.service.list();
  }
}
