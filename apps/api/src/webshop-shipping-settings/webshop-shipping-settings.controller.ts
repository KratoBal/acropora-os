import { Body, Controller, Get, Put } from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";

import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { WebshopShippingSettingsService } from "./webshop-shipping-settings.service.js";

/**
 * A WEBSHOP SZÁLLÍTÁSI DÍJAI ÉS FIZETÉSI MÓDJAI (kártya e0e2378b): olvasás, a díjak mentése, a mátrix mentése. Árdöntés,
 * ezért a beállítások kezelőinek jár (`SETTINGS_MANAGE`), az olvasás is.
 */
@Controller("webshop-shipping-settings")
export class WebshopShippingSettingsController {
  constructor(private readonly settings: WebshopShippingSettingsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  get() {
    return this.settings.get();
  }

  @Put("fees")
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  saveFees(@Body() body: unknown) {
    return this.settings.saveFees(body);
  }

  @Put("payments")
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  savePayments(@Body() body: unknown) {
    return this.settings.savePayments(body);
  }
}
