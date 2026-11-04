import type { Prisma } from "@acropora/database";

import {
  lowestPriceInWindow,
  seriesOfVariant,
  type HistoryRow,
  type LowestPrice,
} from "./lowest-price.js";

/**
 * THE LOWEST PRICE OF ONE VARIANT, READ FROM THE DATABASE (V0.2, slice 1). Nothing calls it yet.
 *
 * It asks the history for BOTH kinds of row of the variant's product, and says so in the query
 * (the guard in `own-price-history.guard.spec.ts` requires every reader to name the kind): the
 * product's mirror rows (`variantId: null`) and this variant's own rows. The computation is
 * `lowestPriceInWindow` over the series `seriesOfVariant` builds.
 */
export interface LowestPriceDatabase {
  productVariant: {
    findUnique(args: unknown): Promise<{
      productId: string;
      unasVariantExtraGrossPrice: Prisma.Decimal | null;
    } | null>;
  };
  productPriceHistory: {
    findMany(args: unknown): Promise<HistoryRow[]>;
  };
}

export async function lowestPriceForVariant(
  database: LowestPriceDatabase,
  variantId: string,
  asOf: Date = new Date(),
): Promise<LowestPrice | null> {
  const variant = await database.productVariant.findUnique({
    where: { id: variantId },
    select: { productId: true, unasVariantExtraGrossPrice: true },
  });
  if (!variant) return null;
  const rows = await database.productPriceHistory.findMany({
    where: {
      productId: variant.productId,
      OR: [{ variantId: null }, { variantId }],
    },
    select: {
      variantId: true,
      observedAt: true,
      createdAt: true,
      currency: true,
      grossPrice: true,
      saleGrossPrice: true,
    },
    orderBy: [{ observedAt: "asc" }, { createdAt: "asc" }],
  });
  return lowestPriceInWindow(
    seriesOfVariant(rows, variantId, variant.unasVariantExtraGrossPrice),
    asOf,
  );
}
