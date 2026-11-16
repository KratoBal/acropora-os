import { Body, Controller, Get, Param, Patch } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { UpdateProductHusbandryDto } from "./dto/update-product-husbandry.dto.js";
import { ProductHusbandryService } from "./product-husbandry.service.js";

/**
 * THE HUSBANDRY BLOCK OF A LIVE ANIMAL (V2.2, card d2fc06e7). The facts are Acropora-owned (the UNAS sync does not write
 * them), so, like the names, they are written on a UNAS-managed product too.
 */
@Controller("products/:productId/husbandry")
export class ProductHusbandryController {
  constructor(private readonly husbandry: ProductHusbandryService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PRODUCTS_VIEW)
  get(@Param("productId") productId: string) {
    return this.husbandry.get(productId);
  }

  @Patch()
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  update(
    @Param("productId") productId: string,
    @Body() input: UpdateProductHusbandryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.husbandry.update(productId, input, user.id);
  }
}
