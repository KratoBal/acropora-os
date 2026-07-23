import { Controller, Get, Param } from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";

import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { PostalCodeService } from "./postal-code.service.js";

@Controller("integrations/postal-code")
export class PostalCodeController {
  constructor(private readonly service: PostalCodeService) {}

  @Get(":zip")
  @RequirePermissions(PERMISSIONS.CUSTOMERS_MANAGE)
  lookup(@Param("zip") zip: string) {
    return this.service.lookupCity(zip);
  }
}
