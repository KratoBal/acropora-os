import { Controller, Get, Param } from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";

import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { ViesVatService } from "./vies-vat.service.js";

@Controller("integrations/vies")
export class ViesVatController {
  constructor(private readonly service: ViesVatService) {}

  @Get("check/:taxNumber")
  @RequirePermissions(PERMISSIONS.PURCHASING_MANAGE)
  check(@Param("taxNumber") taxNumber: string) {
    return this.service.check(taxNumber);
  }
}
