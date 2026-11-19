import {
  Body,
  Controller,
  Get,
  Param,
  ParseBoolPipe,
  Post,
  Query,
} from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";

import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { WebshopCustomerDiscountsService } from "./webshop-customer-discounts.service.js";

/**
 * VEVŐNKÉNTI KEDVEZMÉNY (kártya 20713f62): lista, vevő-kereső, beállítás, be- és kikapcsolás. Árdöntés, ezért a
 * beállítások kezelőié (`SETTINGS_MANAGE`), ugyanúgy, mint a kuponé; a kereső is, mert vevői e-mail címeket ad vissza.
 */
@Controller("webshop-customer-discounts")
export class WebshopCustomerDiscountsController {
  constructor(private readonly discounts: WebshopCustomerDiscountsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  list() {
    return this.discounts.list();
  }

  @Get("customers")
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  searchCustomers(@Query("q") q: string) {
    return this.discounts.searchCustomers(q);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  set(@Body() body: unknown) {
    return this.discounts.set(body);
  }

  @Post(":id/active/:active")
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  setActive(
    @Param("id") id: string,
    @Param("active", ParseBoolPipe) active: boolean,
  ) {
    return this.discounts.setActive(id, active);
  }
}
