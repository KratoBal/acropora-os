import { Body, Controller, Get, Put } from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";

import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { WebshopPriceRulesService } from "./webshop-price-rules.service.js";

/**
 * A WEBSHOP HŰSÉGPONT- ÉS ÁRSZABÁLYAI (acrobot 60467): olvasás és mentés. Árdöntés, ezért a beállítások kezelőinek jár
 * (`SETTINGS_MANAGE`), az olvasás is, mint a szállítási díjaknál.
 */
@Controller("webshop-price-rules")
export class WebshopPriceRulesController {
  constructor(private readonly rules: WebshopPriceRulesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  get() {
    return this.rules.get();
  }

  @Put()
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  save(@Body() body: unknown) {
    return this.rules.save(body);
  }
}
