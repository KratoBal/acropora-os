import { Body, Controller, Get, Put } from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";

import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { WebshopCustomerTextsService } from "./webshop-customer-texts.service.js";

/**
 * A WEBSHOP VEVŐI SZÖVEGEI (kártya 7bfca4eb): olvasás és mentés. A kirakat minden vevő elé tett szövege, ezért a beállítások
 * kezelőinek jár (`SETTINGS_MANAGE`), az olvasás is, mint az árszabályoknál.
 */
@Controller("webshop-customer-texts")
export class WebshopCustomerTextsController {
  constructor(private readonly texts: WebshopCustomerTextsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  get() {
    return this.texts.get();
  }

  @Put()
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  save(@Body() body: unknown) {
    return this.texts.save(body);
  }
}
