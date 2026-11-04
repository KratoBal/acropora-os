import type { Prisma } from "@acropora/database";

import {
  currentReductionStart,
  lowestPriceInWindow,
  seriesOfVariant,
  type HistoryRow,
  type LowestPrice,
} from "./lowest-price.js";

/**
 * THE LOWEST PRICE OF ONE VARIANT IN THE 30 DAYS BEFORE A REDUCTION, READ FROM THE DATABASE (V0.2,
 * slice 1). `reductionStart` is REQUIRED: the caller says when the reduction began, nothing here
 * assumes "now" (the running sale price would be its own reference). Nothing calls it yet.
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

/** The history of the variant's product (both row kinds) and the variant's surcharge, or null for an unknown variant. */
async function readSeries(database: LowestPriceDatabase, variantId: string) {
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
  return {
    rows,
    series: seriesOfVariant(
      rows,
      variantId,
      variant.unasVariantExtraGrossPrice,
    ),
  };
}

export async function lowestPriceForVariant(
  database: LowestPriceDatabase,
  variantId: string,
  reductionStart: Date,
): Promise<LowestPrice | null> {
  const read = await readSeries(database, variantId);
  return read ? lowestPriceInWindow(read.series, reductionStart) : null;
}

/**
 * THE REFERENCE PRICE OF THE REDUCTION THAT RUNS NOW (V0.2, slice 2): the lowest price of the 30
 * days before the reduction began. Null when no reduction runs (nothing to name) or when the
 * history has no known price to name; the caller clears the shop's key then.
 */
export async function lowestPriceBeforeCurrentReduction(
  database: LowestPriceDatabase,
  variantId: string,
): Promise<LowestPrice | null> {
  const read = await readSeries(database, variantId);
  if (!read) return null;
  const start = currentReductionStart(read.rows, variantId);
  return start ? lowestPriceInWindow(read.series, start) : null;
}
