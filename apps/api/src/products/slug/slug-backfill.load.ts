import type { PrismaClient } from "@acropora/database";

import {
  planSlugBackfill,
  type SlugBackfillPlan,
  type SlugBackfillProduct,
} from "./slug-backfill.js";

export type SlugPlanDb = Pick<PrismaClient, "product" | "slugHistory">;

export interface LoadedSlugPlan {
  products: SlugBackfillProduct[];
  plan: SlugBackfillPlan;
}

/**
 * THE ONE LOAD BEHIND THE SLUG PLAN (SEO P0 PR 5; card f6cb0a51 (d)). The `slug-backfill` command and the read-only plan endpoint
 * both call this, so what the endpoint shows is exactly what `--apply` writes. Reads only.
 */
export async function loadSlugBackfillPlan(
  db: SlugPlanDb,
): Promise<LoadedSlugPlan> {
  const [termekek, regi] = await Promise.all([
    db.product.findMany({
      orderBy: { id: "asc" },
      select: {
        id: true,
        name: true,
        variants: {
          where: { isActive: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: 1,
          select: { sku: true },
        },
        channelListings: {
          where: { channel: "WEBSHOP" },
          select: { slug: true },
        },
      },
    }),
    db.slugHistory.findMany({
      where: { entityType: "PRODUCT" },
      select: { slug: true },
    }),
  ]);
  const products = termekek.map((t) => ({
    id: t.id,
    name: t.name,
    primarySku: t.variants[0]?.sku ?? null,
    slug: t.channelListings[0]?.slug ?? null,
  }));
  return {
    products,
    plan: planSlugBackfill(
      products,
      regi.map((r) => r.slug),
    ),
  };
}
