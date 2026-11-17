import { Inject, Injectable } from "@nestjs/common";

import { describeSlugBackfill } from "./slug-backfill.js";
import { loadSlugBackfillPlan, type SlugPlanDb } from "./slug-backfill.load.js";

export const SLUG_PLAN_DB = Symbol("SLUG_PLAN_DB");

export type SlugPlanClash = "none" | "sku" | "number";

export interface SlugPlanRow {
  productId: string;
  name: string;
  /** The primary sku (the first active variant's), or null when the product has no active variant. */
  sku: string | null;
  /** The slug `--apply` would write. */
  slug: string;
  /** `none`: the plain slug was free; `sku`: it clashed, the sku suffix was added; `number`: the suffixed one clashed too. */
  clash: SlugPlanClash;
}

export interface WebshopSlugPlanView {
  rows: SlugPlanRow[];
  counts: { missing: number; alreadySlugged: number };
  /** The text the `slug-backfill` dry run prints first: the same function, so the two cannot differ. */
  summary: string;
}

/**
 * THE READ-ONLY WEBSHOP SLUG PLAN (`GET seo/webshop-slug-plan`, `products.view`; card f6cb0a51 (d)). The test stage runs commands as a
 * Coolify one-off job that returns only success or failed, so the dry run of `slug-backfill` cannot be read there. This returns the
 * same plan (`loadSlugBackfillPlan`, the one load the command also uses) as rows. It never writes.
 */
@Injectable()
export class WebshopSlugPlanService {
  constructor(@Inject(SLUG_PLAN_DB) private readonly db: SlugPlanDb) {}

  async plan(): Promise<WebshopSlugPlanView> {
    const { products, plan } = await loadSlugBackfillPlan(this.db);
    const bySku = new Set(plan.skuSuffix.map((a) => a.productId));
    const byNumber = new Set(plan.numbered.map((a) => a.productId));
    const byId = new Map(products.map((p) => [p.id, p]));
    return {
      rows: plan.assignments.map((a) => {
        const product = byId.get(a.productId);
        return {
          productId: a.productId,
          name: product?.name ?? "",
          sku: product?.primarySku ?? null,
          slug: a.slug,
          clash: byNumber.has(a.productId)
            ? "number"
            : bySku.has(a.productId)
              ? "sku"
              : "none",
        };
      }),
      counts: {
        missing: plan.assignments.length,
        alreadySlugged: plan.alreadySlugged,
      },
      summary: describeSlugBackfill(plan),
    };
  }
}
