import { Inject, Injectable, Optional } from "@nestjs/common";
import type {
  AuthenticatedUser,
  ProductEnrichmentFieldKey,
  ProductEnrichmentReview,
  ProductFieldStatus,
  ProductFieldTier,
  ProductQualityQueueFilter,
  ProductQualityQueuePage,
} from "@acropora/types";

import { enrichmentAvailabilityFor } from "./enrichment/enrichment-availability.js";
import { toFieldReview } from "./enrichment/enrichment-read.js";
import {
  ENRICHMENT_READER,
  type EnrichmentReader,
} from "./enrichment/enrichment-read.repository.js";
import { queueSummary } from "./enrichment/quality-queue.js";
import { ProductService } from "./product.service.js";

/**
 * JEV PRODUCT ENRICHMENT, READ ONLY: WHAT THE PAGES MAY SHOW
 * (docs/jev-product-intelligence/v1-discovery.md §7, §11; PD-013).
 *
 * The switch is `JEV_PRODUCT_ENRICHMENT`, read here on the server only, and
 * since PD-013 also `JEV_PILOT_USER_IDS`: in `benchmark` and `review` only
 * the users on that list see anything (`enrichmentAvailabilityFor`). Anyone
 * else gets "off", with no run and no field: nothing leaks to them.
 *
 * The data is the latest FINISHED shadow run of the product
 * (`enrichment/enrichment-run.ts`), read from the enrichment tables. This
 * service reads; it writes nothing and calls nothing outside.
 */
export const PRODUCT_ENRICHMENT_ENV = Symbol("PRODUCT_ENRICHMENT_ENV");

// The parsing lives in its own pure file: the menu reads the same switch.
export { productEnrichmentAvailability } from "./product-enrichment-availability.js";

export const QUEUE_PAGE_SIZE = 50;

@Injectable()
export class ProductEnrichmentReviewService {
  constructor(
    private readonly products: ProductService,
    @Inject(ENRICHMENT_READER) private readonly reader: EnrichmentReader,
    @Optional()
    @Inject(PRODUCT_ENRICHMENT_ENV)
    private readonly environment: NodeJS.ProcessEnv = process.env,
  ) {}

  /** 404 for an unknown product, like the product detail itself. */
  async review(
    productId: string,
    user: Pick<AuthenticatedUser, "id">,
  ): Promise<ProductEnrichmentReview> {
    await this.products.getProduct(productId);
    const availability = enrichmentAvailabilityFor(this.environment, user.id);
    if (availability === "off")
      return { availability, lastRun: null, fields: [] };
    const check = await this.reader.latestCheck(productId);
    if (!check) return { availability, lastRun: null, fields: [] };
    return {
      availability,
      lastRun: {
        at: check.checkedAt.toISOString(),
        sourceCount: check.sourceCount,
        fieldCount: check.fieldCount,
      },
      fields: check.fields.map(toFieldReview),
    };
  }

  /**
   * The catalogue queue: the fields of the latest check of every product,
   * filtered and counted on the server, a page at a time.
   */
  async queue(
    user: Pick<AuthenticatedUser, "id">,
    filter: ProductQualityQueueFilter,
    cursor: string | null,
  ): Promise<ProductQualityQueuePage> {
    const availability = enrichmentAvailabilityFor(this.environment, user.id);
    const empty: ProductQualityQueuePage = {
      availability,
      filter,
      rows: [],
      nextCursor: null,
      summary: queueSummary([]),
      checkedProducts: 0,
    };
    if (availability === "off") return empty;
    const latest = await this.reader.latestFieldResults();
    if (latest.length === 0) return empty;
    const resultIds = latest.map((row) => row.id);
    const [counts, rows] = await Promise.all([
      this.reader.queueCounts(resultIds),
      this.reader.queueRows(resultIds, filter, cursor, QUEUE_PAGE_SIZE + 1),
    ]);
    const page = rows.slice(0, QUEUE_PAGE_SIZE);
    return {
      availability,
      filter,
      rows: page.map((row) => ({
        productId: row.productId,
        productName: row.productName,
        field: row.field as ProductEnrichmentFieldKey,
        tier: row.tier as ProductFieldTier,
        status: row.status as ProductFieldStatus,
        lastCheckedAt: row.checkedAt.toISOString(),
      })),
      nextCursor: rows.length > QUEUE_PAGE_SIZE ? page.at(-1)!.id : null,
      summary: queueSummary(counts),
      checkedProducts: new Set(latest.map((row) => row.productId)).size,
    };
  }
}
