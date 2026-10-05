import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { WebshopOrderStatusChangeDto } from "./dto/webshop-order-status-change.dto.js";
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

  /** Státuszváltás a webshopban; a válasz a friss adatlap. */
  @Post(":id/status")
  @RequirePermissions(PERMISSIONS.ORDERS_MANAGE)
  changeStatus(
    @Param("id") id: string,
    @Body() body: WebshopOrderStatusChangeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orders.changeStatus(id, body.status, user.id);
  }
}
