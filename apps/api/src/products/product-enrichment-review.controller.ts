import { Controller, Get, Param } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { ProductEnrichmentReviewService } from "./product-enrichment-review.service.js";

/**
 * `GET /products/:id/enrichment`: the JEV review of one product, read only.
 * Evidence about a product is product data, so it follows `products.view`
 * (discovery Q2), not `settings.manage`. No write route exists here. Who may
 * see it beyond that (the pilot list) is decided in the service.
 */
@Controller("products")
export class ProductEnrichmentReviewController {
  constructor(private readonly reviews: ProductEnrichmentReviewService) {}

  @Get(":id/enrichment")
  @RequirePermissions(PERMISSIONS.PRODUCTS_VIEW)
  review(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.reviews.review(id, user);
  }
}
