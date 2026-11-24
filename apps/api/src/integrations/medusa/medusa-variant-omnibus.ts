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
 * A TAKEN-OVER VARIANT (it has OWN rows) gets a value while its OWN sale runs (T4.1-D3, sale slice
 * 2): the reduction's start is the sale's start, and the history before it holds the shop's earlier
 * prices, earlier own sales included. Without a running own sale its value is "". OPEN BOUNDARY,
 * still named: a Medusa PRICE-LIST reduction made BY HAND on such a variant would show WITHOUT an Omnibus line.
 * The OS's own sale is a price list since ADR-020 (card 54bb3779): it starts when the product projection has
 * already written this key in the same round (the product projection runs before the price projection).
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

/**
 * THE LEAST PRICE HISTORY A REDUCTION NEEDS TO BE ANNOUNCED (card 90c54873; Balázs, 2026-11-24 10:06 UTC: "mehet a 15", and the
 * number is a setting, default 15). The web shop's setting is `omnibus_min_history_days` (commerce #880), whole days from 15 to
 * 30; 15 is the floor of 4/2009. (I. 30.) NFGM-SZMM rendelet 2/A. § for a product on the market for less than 30 days, 30 the
 * general rule. A history that reaches back the full 30 days is complete and always passes; a YOUNG one (its first known price
 * falls inside the 30-day window) must span at least this many days before the reduction began, or the key is not written and
 * the shop shows only the price to pay. THE DEFAULT HERE MIRRORS THE SHOP'S DEFINITION (`DEFAULT_OMNIBUS_MIN_HISTORY_DAYS`).
 */
export const OMNIBUS_MIN_HISTORY_DAYS_DEFAULT = 15;
export const OMNIBUS_MIN_HISTORY_DAYS_MIN = 15;
export const OMNIBUS_MIN_HISTORY_DAYS_MAX = 30;
export const OMNIBUS_MIN_HISTORY_DAYS_SETTING_KEY = "omnibus_min_history_days";

/**
 * THE SETTING AS THE SHOP ANSWERS IT, READ ONCE PER RUN. A stored row's value is text, a default is a number; anything that
 * is not a whole number from 15 to 30 (an unreadable, missing or out-of-bounds answer, a shop that does not know the key yet)
 * reads as the DEFAULT, 15, the decree's floor and never lower: a broken read must not make the OS announce more reductions
 * than the least it is ever allowed to. A person's stricter value (up to 30) is lost for that run when the read fails, and the
 * run says so (`warn`).
 */
export async function readOmnibusMinHistoryDays(
  getSetting: (key: string) => Promise<{ value: string | number | null }>,
  warn: (message: string) => void,
): Promise<number> {
  try {
    const { value } = await getSetting(OMNIBUS_MIN_HISTORY_DAYS_SETTING_KEY);
    const number =
      typeof value === "string" && value.trim() !== "" ? Number(value) : value;
    if (
      typeof number === "number" &&
      Number.isInteger(number) &&
      number >= OMNIBUS_MIN_HISTORY_DAYS_MIN &&
      number <= OMNIBUS_MIN_HISTORY_DAYS_MAX
    )
      return number;
    warn(
      `omnibus: a(z) ${OMNIBUS_MIN_HISTORY_DAYS_SETTING_KEY} beállítás értéke nem használható (${JSON.stringify(value)}), ${OMNIBUS_MIN_HISTORY_DAYS_DEFAULT} nap érvényes`,
    );
  } catch (error) {
    warn(
      `omnibus: a(z) ${OMNIBUS_MIN_HISTORY_DAYS_SETTING_KEY} beállítás nem olvasható (${error instanceof Error ? error.message : String(error)}), ${OMNIBUS_MIN_HISTORY_DAYS_DEFAULT} nap érvényes`,
    );
  }
  return OMNIBUS_MIN_HISTORY_DAYS_DEFAULT;
}

/** Whole calendar days from one YYYY-MM-DD day to a later one (pure calendar arithmetic, no time zone). */
const daysFromTo = (from: string, to: string): number =>
  Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000,
  );

/**
 * The key's value for one variant: the JSON text, or "" (the key is cleared) when no reduction runs, there is no price to name,
 * or the history is younger than `minHistoryDays` (a young history, not a complete one: see `OMNIBUS_MIN_HISTORY_DAYS_DEFAULT`).
 */
export function omnibusMetadataValue(
  lowest: LowestPrice | null,
  minHistoryDays: number = OMNIBUS_MIN_HISTORY_DAYS_DEFAULT,
): string {
  if (lowest === null || lowest.unknownInWindow) return "";
  if (
    !lowest.complete &&
    daysFromTo(day(lowest.historyBegins), day(lowest.reductionStart)) <
      minHistoryDays
  )
    return "";
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
  /** whether a variant's own sale runs: the same "now" as its price decision */
  now: Date = new Date(),
  /** the setting `omnibus_min_history_days`, read once per run by the caller */
  minHistoryDays: number = OMNIBUS_MIN_HISTORY_DAYS_DEFAULT,
): Promise<VariantOmnibusInput[] | undefined> {
  if (!omnibusProjectionEnabled(env)) return undefined;
  return Promise.all(
    variants.map(async (variant) => {
      const lowest = await lowestPriceBeforeCurrentReduction(
        database,
        variant.id,
        now,
      );
      return {
        sku: variant.sku,
        value: omnibusMetadataValue(lowest, minHistoryDays),
        ...(lowest?.unknownInWindow ? { gap: true } : {}),
      };
    }),
  );
}
