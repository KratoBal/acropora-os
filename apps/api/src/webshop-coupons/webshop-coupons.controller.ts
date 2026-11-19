import {
  Body,
  Controller,
  Get,
  Param,
  ParseBoolPipe,
  Post,
} from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";

import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { WebshopCouponsService } from "./webshop-coupons.service.js";

/**
 * A WEBSHOP KUPONJAI (kártya 393ae5cb): lista, felvétel, be- és kikapcsolás. A kupon árdöntés, ezért mindhárom a
 * beállítások kezelőinek jár (`SETTINGS_MANAGE`), az olvasás is: a kódok listája maga is üzleti adat.
 */
@Controller("webshop-coupons")
export class WebshopCouponsController {
  constructor(private readonly coupons: WebshopCouponsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  list() {
    return this.coupons.list();
  }

  @Post()
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  create(@Body() body: unknown) {
    return this.coupons.create(body);
  }

  @Post(":id/active/:active")
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  setActive(
    @Param("id") id: string,
    @Param("active", ParseBoolPipe) active: boolean,
  ) {
    return this.coupons.setActive(id, active);
  }
}
