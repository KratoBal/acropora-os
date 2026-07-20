import { Body, Controller, Get, Param, Put } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { UpsertProductExtensionDto } from "./dto/upsert-product-extension.dto.js";
import { ProductExtensionService } from "./product-extension.service.js";

@Controller("product-extensions")
export class ProductExtensionController {
  constructor(private readonly extensions: ProductExtensionService) {}

  @Get(":variantId")
  @RequirePermissions(PERMISSIONS.PRODUCTS_VIEW)
  getByVariantId(@Param("variantId") variantId: string) {
    return this.extensions.getByVariantId(variantId);
  }

  @Put(":variantId")
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  upsert(
    @Param("variantId") variantId: string,
    @Body() input: UpsertProductExtensionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.extensions.upsert(variantId, input, user.id);
  }
}
