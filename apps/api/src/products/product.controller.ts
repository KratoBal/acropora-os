import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { CreateProductDto } from "./dto/create-product.dto.js";
import { ProductListQueryDto } from "./dto/product-list-query.dto.js";
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

  @Delete(":id")
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  archiveProduct(@Param("id") id: string) {
    return this.products.archiveProduct(id);
  }
}
