import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Put,
} from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { SetProductDiscontinuationDto } from "./dto/set-product-discontinuation.dto.js";
import { ProductDiscontinuationService } from "./product-discontinuation.service.js";

/**
 * THE MANUAL "PERMANENTLY DISCONTINUED" MARK, AND ITS ONLY WRITE PATH (V4.2, card 9d0523fa). A person is on the
 * other end, with a permission and an audit trail; the UNAS sync has no way to this table (see the model).
 */
@Controller("products/:productId/discontinuation")
export class ProductDiscontinuationController {
  constructor(private readonly marks: ProductDiscontinuationService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PRODUCTS_VIEW)
  get(@Param("productId") productId: string) {
    return this.marks.get(productId);
  }

  @Put()
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  set(
    @Param("productId") productId: string,
    @Body() input: SetProductDiscontinuationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.marks.set(productId, input.replacementProductId, user.id);
  }

  @Delete()
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  async remove(
    @Param("productId") productId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.marks.remove(productId, user.id);
  }
}
