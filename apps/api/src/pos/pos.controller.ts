import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { CreatePosSaleDto } from "./dto/create-pos-sale.dto.js";
import { PosProductSearchQueryDto } from "./dto/pos-product-search-query.dto.js";
import { PosSaleListQueryDto } from "./dto/pos-sale-list-query.dto.js";
import { PosProductSearchService } from "./pos-product-search.service.js";
import { PosSaleService } from "./pos-sale.service.js";

@Controller("pos")
export class PosController {
  constructor(
    private readonly search: PosProductSearchService,
    private readonly sales: PosSaleService,
  ) {}

  @Get("products")
  @RequirePermissions(PERMISSIONS.ORDERS_VIEW)
  searchProducts(@Query() query: PosProductSearchQueryDto) {
    return this.search.search(query.q);
  }

  @Get("sales")
  @RequirePermissions(PERMISSIONS.ORDERS_VIEW)
  listSales(@Query() query: PosSaleListQueryDto) {
    return this.sales.list(query);
  }

  @Get("sales/:id")
  @RequirePermissions(PERMISSIONS.ORDERS_VIEW)
  getSale(@Param("id") id: string) {
    return this.sales.getDetail(id);
  }

  @Post("sales")
  @RequirePermissions(PERMISSIONS.ORDERS_MANAGE)
  createSale(
    @Body() dto: CreatePosSaleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sales.createSale(dto, user.id);
  }
}
