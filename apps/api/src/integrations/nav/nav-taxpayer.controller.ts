import { Controller, Get, Param } from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";

import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { NavTaxpayerService } from "./nav-taxpayer.service.js";

@Controller("integrations/nav")
export class NavTaxpayerController {
  constructor(private readonly service: NavTaxpayerService) {}

  @Get("taxpayer/:taxNumber")
  @RequirePermissions(PERMISSIONS.CUSTOMERS_MANAGE)
  lookup(@Param("taxNumber") taxNumber: string) {
    return this.service.lookup(taxNumber);
  }
}
