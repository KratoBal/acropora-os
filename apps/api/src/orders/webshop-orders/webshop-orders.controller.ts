import { Controller, Get, Param, Query } from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";

import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { WebshopOrderListQueryDto } from "./dto/webshop-order-list-query.dto.js";
import { WebshopOrdersService } from "./webshop-orders.service.js";

/** Webshop / Rendelések: az új webshop rendelései (nem a UNAS-é, az a `integrations/unas/orders`). */
@Controller("webshop-orders")
export class WebshopOrdersController {
  constructor(private readonly orders: WebshopOrdersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.ORDERS_VIEW)
  list(@Query() query: WebshopOrderListQueryDto) {
    return this.orders.list(query);
  }

  @Get(":id")
  @RequirePermissions(PERMISSIONS.ORDERS_VIEW)
  detail(@Param("id") id: string) {
    return this.orders.detail(id);
  }
}
