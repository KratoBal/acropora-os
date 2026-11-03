import type { Prisma } from "@acropora/database";

import {
  kellUjArSor,
  type ArKep,
} from "../../imports/unas/unas-ar-tortenet.js";

/**
 * THE ONE WRITER OF A VARIANT'S OWN PRICE INTO THE PRICE HISTORY (card edd0c25b, T4.1-D2).
 *
 * WHY IT EXISTS. After a product is taken over (`catalogAuthority = ACROPORA`) the UNAS sync
 * skips it, so the history that the sync fed stops; the price the shop shows comes from
 * `ProductVariant.sellingGrossPrice`, and until now nothing wrote that into the history. The
 * Omnibus question (the lowest price in the last 30 days) would have had no baseline for the
 * very products the shop is moving to.
 *
 * WHY PER VARIANT. The Omnibus rule is about the price the customer sees, and that differs per
 * variant; the mirror-fed rows are per product. So an own-price row carries `variantId` and
 * `source = OWN`, and the mirror rows keep `variantId = null`.
 *
 * WHEN A ROW IS WRITTEN. The first time a variant's own price is seen (the takeover's start
 * row, so the 30-day window has a beginning), and afterwards only when the price or its
 * currency CHANGED, with the same rule as the mirror history (`kellUjArSor`): the history's
 * content is the difference, not how often someone saved.
 *
 * THE RULE THAT KEEPS IT TRUE: whoever writes `ProductVariant.sellingGrossPrice` calls this in
 * the SAME transaction. A spec (`own-price-history.guard.spec.ts`) fails when a file writes the
 * field without it, so the price editor that does not exist yet (D3) cannot be added without it.
 *
 * NO READER YET: nothing computes the 30-day lowest price today; this only collects.
 */
export interface OwnPriceHistoryTransaction {
  productPriceHistory: {
    findFirst(args: unknown): Promise<ArKep | null>;
    create(args: unknown): Promise<unknown>;
  };
}

export interface OwnPriceInput {
  productId: string;
  variantId: string;
  /** ISO 4217; the database accepts a price only together with its currency */
  currency: string;
  /** a `Decimal`, not a string: the comparison normalises on the Decimal's own text */
  grossPrice: Prisma.Decimal;
  observedAt: Date;
}

export async function recordOwnPrice(
  transaction: OwnPriceHistoryTransaction,
  input: OwnPriceInput,
): Promise<"written" | "unchanged"> {
  const image = {
    currency: input.currency,
    netPrice: null,
    grossPrice: input.grossPrice,
    saleNetPrice: null,
    saleGrossPrice: null,
  };
  const last = await transaction.productPriceHistory.findFirst({
    where: { variantId: input.variantId },
    orderBy: [{ observedAt: "desc" }, { createdAt: "desc" }],
    select: {
      currency: true,
      netPrice: true,
      grossPrice: true,
      saleNetPrice: true,
      saleGrossPrice: true,
    },
  });
  if (!kellUjArSor(last, image)) return "unchanged";
  await transaction.productPriceHistory.create({
    data: {
      productId: input.productId,
      variantId: input.variantId,
      source: "OWN",
      observedAt: input.observedAt,
      ...image,
    },
  });
  return "written";
}
