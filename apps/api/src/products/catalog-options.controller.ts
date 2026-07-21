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

  // GET /brands/options is served by BrandsController instead: that
  // controller also owns GET /brands/:id, and the "options" route has to
  // be declared in the same controller, before ":id", to avoid Nest/Express
  // matching "options" as an :id parameter (see brands.controller.ts).
}
