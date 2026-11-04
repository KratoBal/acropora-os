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
 *   history_begins         the first day we have a price for (YYYY-MM-DD, BUDAPEST day): a variant
 *                          younger than 30 days is named by it, the storefront decides what the line
 *                          says then (it is the first KNOWN PRICE in our history, not the day the
 *                          product became available)
 *   complete               the history reaches back 30 days
 *   reduction_start        YYYY-MM-DD: the day the running reduction began
 * A `computed_at` is deliberately NOT here: it would change every run, and every run would write
 * every variant. The value changes only when the reference or the reduction does, and the key is
 * cleared when the reduction ends: the reference is tied to the reduction, so it does not age on
 * its own (a stale value would need a reduction that has no end, and then the shop still sells the
 * reduced price and the line is still true).
 *
 * A GAP IN THE WINDOW GETS NO VALUE (acrobot's decision, 2026-11-04): when the window holds a stretch
 * with an unknown price, the key is cleared and the round's report names the variant ("omnibus: rés
 * az ablakban"), so a person sees it BEFORE a reduction is started. A false or misleading reference
 * price is worse than none. Whether a reduction may be announced then is a business and legal
 * decision (on the list for Balázs before going live); on the test shop this is the behaviour.
 *
 * OPEN BOUNDARY, named: a variant taken over by the OS (it has OWN rows) has no sale concept in the
 * history, so its value is always "" (the key is cleared). If a Medusa PRICE-LIST reduction runs on
 * such a variant, the shop shows a reduction WITHOUT an Omnibus line. Today this probably does not
 * occur (the OS creates no price lists); it must be solved before one does.
 *
 * OFF BY DEFAULT: `MEDUSA_PROJECT_OMNIBUS=true`, EXACTLY that (the knowledge switch's pattern).
 * Nothing in this file writes; the projection service does, and only with the switch.
 */
export const OMNIBUS_METADATA_KEY = "omnibus_lowest_price_30d";

export const omnibusProjectionEnabled = (
  env: Record<string, string | undefined>,
): boolean => env.MEDUSA_PROJECT_OMNIBUS === "true";

/** The BUDAPEST calendar day (YYYY-MM-DD): a row seen at 23:30 UTC is already the next day for the shopper. */
const dayFormat = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Budapest",
});
export const day = (at: Date) => dayFormat.format(at);

/** The key's value for one variant: the JSON text, or "" (the key is cleared) when no reduction runs or there is no price to name. */
export function omnibusMetadataValue(lowest: LowestPrice | null): string {
  if (lowest === null || lowest.unknownInWindow) return "";
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
  /** an unknown-price stretch in the window: no value (cleared), and the report names the variant */
  gap?: boolean;
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
    variants.map(async (variant) => {
      const lowest = await lowestPriceBeforeCurrentReduction(
        database,
        variant.id,
      );
      return {
        sku: variant.sku,
        value: omnibusMetadataValue(lowest),
        ...(lowest?.unknownInWindow ? { gap: true } : {}),
      };
    }),
  );
}
