import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { CreatePurchaseInvoiceDto } from "./dto/create-purchase-invoice.dto.js";
import { ExchangeRateQueryDto } from "./dto/exchange-rate-query.dto.js";
import { PurchaseInvoiceListQueryDto } from "./dto/purchase-invoice-list-query.dto.js";
import { PurchaseProductSearchQueryDto } from "./dto/purchase-product-search-query.dto.js";
import { PurchasingService } from "./purchasing.service.js";

@Controller("purchasing")
export class PurchasingController {
  constructor(private readonly service: PurchasingService) {}

  @Get("products/search")
  @RequirePermissions(PERMISSIONS.PURCHASING_VIEW)
  searchProducts(@Query() query: PurchaseProductSearchQueryDto) {
    return this.service.searchProducts(query.q);
  }

  @Get("exchange-rate")
  @RequirePermissions(PERMISSIONS.PURCHASING_VIEW)
  getExchangeRate(@Query() query: ExchangeRateQueryDto) {
    return this.service.getExchangeRate(query.currency, query.date);
  }

  @Get("invoices")
  @RequirePermissions(PERMISSIONS.PURCHASING_VIEW)
  listInvoices(@Query() query: PurchaseInvoiceListQueryDto) {
    return this.service.list(query);
  }

  @Get("invoices/:id")
  @RequirePermissions(PERMISSIONS.PURCHASING_VIEW)
  getInvoice(@Param("id") id: string) {
    return this.service.getDetail(id);
  }

  @Post("invoices")
  @RequirePermissions(PERMISSIONS.PURCHASING_MANAGE)
  createInvoice(
    @Body() input: CreatePurchaseInvoiceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.createInvoice(input, user.id);
  }
}
