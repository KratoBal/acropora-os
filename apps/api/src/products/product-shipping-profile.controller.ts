import { Body, Controller, Get, Param, Put } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { UpsertProductShippingProfileDto } from "./dto/upsert-product-shipping-profile.dto.js";
import { ProductShippingProfileService } from "./product-shipping-profile.service.js";

/**
 * A SZALLITASI JELLEMZOK KEZI GONDOZASA -- EZ AZ EGYETLEN IRASI UT.
 *
 * A tabla azert all kulon, hogy a UNAS-szinkronnak NE legyen hozza irasi utja.
 * Ez a vegpont nem gyengiti ezt: emberi kez van a masik vegen, jogosultsaggal es
 * naploval. Ha valaha gepi iro is kell, az KULON dontes legyen, ne ennek a
 * vegpontnak a mellekhasznalata.
 */
@Controller("products/:productId/shipping-profile")
export class ProductShippingProfileController {
  constructor(private readonly profiles: ProductShippingProfileService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PRODUCTS_VIEW)
  get(@Param("productId") productId: string) {
    return this.profiles.getByProductId(productId);
  }

  @Put()
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  upsert(
    @Param("productId") productId: string,
    @Body() input: UpsertProductShippingProfileDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.profiles.upsert(productId, input, user.id);
  }
}
