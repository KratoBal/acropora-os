import { MEDUSA_CURRENCY_CODE } from "./medusa-pricing.policy.js";
import type { LowestPrice } from "../../products/price-history/lowest-price.js";
import {
  lowestPriceBeforeCurrentReduction,
  type LowestPriceDatabase,
} from "../../products/price-history/lowest-price.reader.js";

/**
 * THE OMNIBUS METADATA OF A VARIANT, AS THE SHOP GETS IT (V0.2, slice 2).
 *
 * ONE KEY, OURS: `omnibus_lowest_price_30d`, a JSON text on the variant's metadata. The Medusa
 * (2.20.1) merges metadata KEY by key, and an empty text deletes the key, so this projection
 * writes only its own key and can clear it: it needs no ledger, because the key is entirely ours.
 *
 * THE TEXT CARRIES WHAT THE STOREFRONT MUST KNOW TO STAY TRUE, AND NOTHING THAT CHANGES DAILY:
 *   amount, currency       the lowest price of the 30 days BEFORE the running reduction began (the
 *                          Omnibus reference; the sale price itself is never its own reference)
 *   history_begins         the first day we have a price for (YYYY-MM-DD): a variant younger than
 *                          30 days is named by it, the storefront decides what the line says then
 *   complete               the history reaches back 30 days
 *   reduction_start        YYYY-MM-DD: the day the running reduction began
 * A `computed_at` is deliberately NOT here: it would change every run, and every run would write
 * every variant. The value changes only when the reference or the reduction does, and the key is
 * cleared when the reduction ends: the reference is tied to the reduction, so it does not age on
 * its own (a stale value would need a reduction that has no end, and then the shop still sells the
 * reduced price and the line is still true).
 *
 * OFF BY DEFAULT: `MEDUSA_PROJECT_OMNIBUS=true`, EXACTLY that (the knowledge switch's pattern).
 * Nothing in this file writes; the projection service does, and only with the switch.
 */
export const OMNIBUS_METADATA_KEY = "omnibus_lowest_price_30d";

export const omnibusProjectionEnabled = (
  env: Record<string, string | undefined>,
): boolean => env.MEDUSA_PROJECT_OMNIBUS === "true";

const day = (at: Date) => at.toISOString().slice(0, 10);

/** The key's value for one variant: the JSON text, or "" (the key is cleared) when no reduction runs or there is no price to name. */
export function omnibusMetadataValue(lowest: LowestPrice | null): string {
  if (lowest === null) return "";
  return JSON.stringify({
    amount: lowest.amount.toString(),
    currency: lowest.currency ?? MEDUSA_CURRENCY_CODE,
    history_begins: day(lowest.historyBegins),
    complete: lowest.complete,
    reduction_start: day(lowest.reductionStart),
  });
}

export interface VariantOmnibusInput {
  sku: string;
  /** "" clears the key */
  value: string;
}

/** What to do for one shop variant, given its current metadata. */
export function planOmnibusWrite(
  currentMetadata: Record<string, unknown> | null,
  wanted: string,
): "write" | "unchanged" {
  const current = currentMetadata?.[OMNIBUS_METADATA_KEY];
  const present = typeof current === "string" && current !== "";
  if (wanted === "") return present ? "write" : "unchanged";
  return present && current === wanted ? "unchanged" : "write";
}

/**
 * What the projection of ONE product hands to the shop: a value per active variant, or `undefined`
 * when the switch is off (then no history is read and the shop's key is left as it stands). A
 * variant with no running reduction gets "", which clears its key.
 */
export async function omnibusInputsFor(
  database: LowestPriceDatabase,
  variants: readonly { id: string; sku: string }[],
  env: Record<string, string | undefined>,
): Promise<VariantOmnibusInput[] | undefined> {
  if (!omnibusProjectionEnabled(env)) return undefined;
  return Promise.all(
    variants.map(async (variant) => ({
      sku: variant.sku,
      value: omnibusMetadataValue(
        await lowestPriceBeforeCurrentReduction(database, variant.id),
      ),
    })),
  );
}
