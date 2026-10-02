import { Inject, Injectable, Optional } from "@nestjs/common";
import type { ProductEnrichmentReview } from "@acropora/types";

import { productEnrichmentAvailability } from "./product-enrichment-availability.js";
import { ProductService } from "./product.service.js";

/**
 * JEV PRODUCT ENRICHMENT, READ ONLY: WHAT THE PRODUCT PAGE MAY SHOW
 * (docs/jev-product-intelligence/v1-discovery.md §7, §11/1; owner, 2026-10-02).
 *
 * The one switch is `JEV_PRODUCT_ENRICHMENT`, read here, on the server only;
 * the browser learns it from this response and never reads a variable.
 *
 *   off (default; also anything unknown or missing)   unavailable
 *   benchmark | review | production-review            as named
 *
 * No run is persisted anywhere yet, so `lastRun` is always `null` and
 * `fields` always empty: the page shows "unavailable" when off, otherwise
 * "never checked". This service reads no table but the product's own
 * existence, calls no provider and writes nothing. When a persisted run
 * exists, this is where it is read, behind the same contract.
 */
export const PRODUCT_ENRICHMENT_ENV = Symbol("PRODUCT_ENRICHMENT_ENV");

// The parsing lives in its own pure file: the menu reads the same switch.
export { productEnrichmentAvailability } from "./product-enrichment-availability.js";

@Injectable()
export class ProductEnrichmentReviewService {
  constructor(
    private readonly products: ProductService,
    @Optional()
    @Inject(PRODUCT_ENRICHMENT_ENV)
    private readonly environment: NodeJS.ProcessEnv = process.env,
  ) {}

  /** 404 for an unknown product, like the product detail itself. */
  async review(productId: string): Promise<ProductEnrichmentReview> {
    await this.products.getProduct(productId);
    return {
      availability: productEnrichmentAvailability(
        this.environment.JEV_PRODUCT_ENRICHMENT,
      ),
      lastRun: null,
      fields: [],
    };
  }
}
