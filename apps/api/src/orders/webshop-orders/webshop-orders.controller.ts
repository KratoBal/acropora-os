import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { WebshopOrderStatusChangeDto } from "./dto/webshop-order-status-change.dto.js";
import { WebshopOrderListQueryDto } from "./dto/webshop-order-list-query.dto.js";
import { WebshopOrderInvoiceService } from "./webshop-order-invoice.service.js";
import { WebshopOrdersService } from "./webshop-orders.service.js";

/** Webshop / Rendelések: az új webshop rendelései (nem a UNAS-é, az a `integrations/unas/orders`). */
@Controller("webshop-orders")
export class WebshopOrdersController {
  constructor(
    private readonly orders: WebshopOrdersService,
    private readonly invoices: WebshopOrderInvoiceService,
  ) {}

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

  /**
   * A RENDELÉS SZÁMLÁJA: vázlat a rendelésből, és kiállítás. Mindkét jog
   * kell: a rendelés kezelése és a számla kiállítása (ugyanaz, ami a
   * Számlázás kiállítás-gombja mögött áll). A válasz a friss adatlap.
   */
  @Post(":id/invoice")
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.ORDERS_MANAGE, PERMISSIONS.BILLING_ISSUE)
  issueInvoice(
    @Param("id") id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invoices.issue(id, user);
  }
}
