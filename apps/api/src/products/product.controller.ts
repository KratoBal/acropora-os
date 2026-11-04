import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { CreateProductDto } from "./dto/create-product.dto.js";
import {
  SetProductImageAltDto,
  SetProductImageOrderDto,
} from "./dto/product-image.dto.js";
import { ProductListQueryDto } from "./dto/product-list-query.dto.js";
import { SetVariantPriceDto } from "./dto/set-variant-price.dto.js";
import { UpdateProductDto } from "./dto/update-product.dto.js";
import { ProductService } from "./product.service.js";

@Controller("products")
export class ProductController {
  constructor(private readonly products: ProductService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PRODUCTS_VIEW)
  listProducts(@Query() query: ProductListQueryDto) {
    return this.products.listProducts(query);
  }

  @Get(":id")
  @RequirePermissions(PERMISSIONS.PRODUCTS_VIEW)
  getProduct(@Param("id") id: string) {
    return this.products.getProduct(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  createProduct(
    @Body() input: CreateProductDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.products.createProduct(input, user.id);
  }

  @Patch(":id")
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  updateProduct(@Param("id") id: string, @Body() input: UpdateProductDto) {
    return this.products.updateProduct(id, input);
  }

  @Put(":id/variants/:variantId/price")
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  setVariantPrice(
    @Param("id") id: string,
    @Param("variantId") variantId: string,
    @Body() input: SetVariantPriceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.products.setVariantPrice(id, variantId, input, user.id);
  }

  @Patch(":id/images/:imageId")
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  setImageAlt(
    @Param("id") id: string,
    @Param("imageId") imageId: string,
    @Body() input: SetProductImageAltDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.products.setImageAlt(id, imageId, input, user.id);
  }

  @Put(":id/images/order")
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  setImageOrder(
    @Param("id") id: string,
    @Body() input: SetProductImageOrderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.products.setImageOrder(id, input, user.id);
  }

  @Delete(":id")
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  archiveProduct(@Param("id") id: string) {
    return this.products.archiveProduct(id);
  }

  /**
   * Egyirányú útvonal, szándékosan: a cél a névben áll, nem a törzsben.
   *
   * Egy `{ authority: "..." }` törzs azt sugallná, hogy a visszaút is
   * választható, pedig nincs eldöntve, mi történjen ilyenkor a közben
   * elkészült helyi szerkesztésekkel.
   */
  @Post(":id/catalog-authority/acropora")
  @RequirePermissions(PERMISSIONS.PRODUCTS_CATALOG_AUTHORITY_TRANSFER)
  takeCatalogAuthority(
    @Param("id") id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.products.takeCatalogAuthority(id, user.id);
  }
}
