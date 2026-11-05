import { Body, Controller, Post } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { BulkProductShippingProfileDto } from "./dto/bulk-product-shipping-profile.dto.js";
import { ProductShippingProfileService } from "./product-shipping-profile.service.js";

/** A tömeges szerkesztés (a82ed229, 2c): a terméklista kijelöltjein ugyanazok a jelzők, ugyanazzal a joggal. */
@Controller("products/shipping-profiles")
export class ProductShippingProfileBulkController {
  constructor(private readonly profiles: ProductShippingProfileService) {}

  @Post("bulk")
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  bulk(
    @Body() input: BulkProductShippingProfileDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.profiles.bulk(input.productIds, input.changes, user.id);
  }
}
