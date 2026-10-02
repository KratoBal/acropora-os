import { Controller, Get, Param } from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";

import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { ProductEnrichmentReviewService } from "./product-enrichment-review.service.js";

/**
 * `GET /products/:id/enrichment`: the JEV review of one product, read only.
 * Evidence about a product is product data, so it follows `products.view`
 * (discovery Q2), not `settings.manage`. No write route exists here.
 */
@Controller("products")
export class ProductEnrichmentReviewController {
  constructor(private readonly reviews: ProductEnrichmentReviewService) {}

  @Get(":id/enrichment")
  @RequirePermissions(PERMISSIONS.PRODUCTS_VIEW)
  review(@Param("id") id: string) {
    return this.reviews.review(id);
  }
}
