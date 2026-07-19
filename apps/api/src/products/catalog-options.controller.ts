import { Controller, Get } from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";

import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { ProductService } from "./product.service.js";

@Controller()
export class CatalogOptionsController {
  constructor(private readonly products: ProductService) {}

  @Get("categories/options")
  @RequirePermissions(PERMISSIONS.PRODUCTS_VIEW)
  listCategoryOptions() {
    return this.products.listCategoryOptions();
  }

  @Get("brands/options")
  @RequirePermissions(PERMISSIONS.PRODUCTS_VIEW)
  listBrandOptions() {
    return this.products.listBrandOptions();
  }
}
