import { Controller, Get, Query } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { ProductQualityQueueQueryDto } from "./dto/product-quality-queue-query.dto.js";
import { ProductEnrichmentReviewService } from "./product-enrichment-review.service.js";

/**
 * `GET /products/enrichment/queue?filter=&cursor=`: the catalogue
 * data-quality queue (discovery §11/2), read only, `products.view`, paged and
 * filtered on the server with a summary, so the browser never scans the
 * catalogue. The pilot list applies as for the product review.
 */
@Controller("products")
export class ProductEnrichmentQueueController {
  constructor(private readonly reviews: ProductEnrichmentReviewService) {}

  @Get("enrichment/queue")
  @RequirePermissions(PERMISSIONS.PRODUCTS_VIEW)
  queue(
    @Query() query: ProductQualityQueueQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reviews.queue(
      user,
      query.filter ?? "all",
      query.cursor ?? null,
    );
  }
}
