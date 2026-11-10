import type { LivestockKind } from "./medusa-livestock.policy.js";

/**
 * THE HUSBANDRY BLOCK THAT A LIVE ANIMAL'S PRODUCT PAGE MAY SHOW (V2.2 S3, card d2fc06e7): the pure rule, no database, so its
 * words can fail by name. The spec is exchange/otletek-2026-11-04/v2-2-tartasi-blokk.md; the facts live on the product's
 * datasheet (S1, `ProductDatasheet`).
 *
 * WHAT GOES OUT, and when: only a LIVE ANIMAL (the kind comes from the category tree) whose husbandry block is VERIFIED
 * (`ellenorizveAt` set: the server stamps it, and any edit withdraws it). An unverified block says nothing at all: the spec's
 * rule is that nothing is guessed and a number without a source does not get out. A fact that is null is left out of the
 * object (the shop shows "being checked" for it); an empty list is left out too.
 *
 * WHAT NEVER GOES OUT: the source's type and reference and who verified it (internal), the Hungarian name (the product has
 * its own name), the genus and species (the product's title carries the scientific name). The day of the verification goes,
 * as a day (not a time and not a person).
 *
 * THE SHAPE IS A VERSIONED CONTRACT with the storefront (`v`), one string, a fixed key order: the same facts are the same text,
 * so the projection does not rewrite an unchanged key. The values are the OS enum names as they are (`SZAKERTO`, `ALSO`, ...):
 * the storefront owns the Hungarian words (the scale's labels, criteria and the fixed sentences of the 3rd and 4th step), so a
 * wording change is the shop's, a new value is a new version.
 */
export const HUSBANDRY_VERSION = 1;

/**
 * THE SWITCH (`MEDUSA_PROJECT_HUSBANDRY`, EXACTLY `true`, OFF by default, like the knowledge and omnibus switches): the
 * husbandry block leaves the OS only when someone turns it on, because the environment's shop cannot be measured from here.
 * OFF means no key goes out, and, since the key is an owned one, an existing key is taken off at the product's next round.
 */
export const projectHusbandryEnabled = (
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): boolean => env.MEDUSA_PROJECT_HUSBANDRY === "true";

export interface HusbandrySourceRow {
  careDifficulty: string | null;
  /** a decimal column: the Prisma decimal or a number or a text */
  minLiter: { toString(): string } | number | null;
  medenceErettsegHonap: number | null;
  elhelyezesZona: string | null;
  reefSafe: string | null;
  reefSafeIndok: string | null;
  socialKeeping: string | null;
  aggression: readonly string[];
  korallevo: boolean | null;
  gerinctelenevo: boolean | null;
  feedingType: readonly string[];
  etetesGyakorisag: string | null;
  eloEleseg: boolean | null;
  fenyIgeny: string | null;
  aramlasIgeny: string | null;
  meretMax: { toString(): string } | number | null;
  meretDimenzio: string | null;
  szarmazas: string | null;
  kinekNem: string | null;
  /*
    THE OPTIONAL FACTS (V2.2 S1b): additive keys in the same text, `v` stays 1 (a reader that does not know a key ignores it; a
    key that is absent is "being checked"). Missing from a row that predates the columns reads as null.
  */
  tempMinC?: { toString(): string } | number | null;
  tempMaxC?: { toString(): string } | number | null;
  salinityMinSg?: { toString(): string } | number | null;
  salinityMaxSg?: { toString(): string } | number | null;
  khMinDkh?: { toString(): string } | number | null;
  khMaxDkh?: { toString(): string } | number | null;
  lifespanYears?: number | null;
  stingOrVenom?: boolean | null;
  handlingWarning?: string | null;
  quarantineWeeks?: number | null;
  acclimatization?: string | null;
  breedsInTank?: boolean | null;
  ellenorizveAt: Date | null;
}

const KIND_NAMES: Readonly<Record<LivestockKind, string>> = {
  FISH: "fish",
  CORAL: "coral",
  INVERTEBRATE: "invertebrate",
};

const text = (value: string | null): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const numberOf = (
  value: { toString(): string } | number | null,
): number | null => {
  if (value === null) return null;
  const parsed = Number(value.toString());
  return Number.isFinite(parsed) ? parsed : null;
};

/** The key's value for a product, or `null` when there is nothing the shop may say (the merge then takes the key off). */
export function husbandryMetadata(
  row: HusbandrySourceRow | null | undefined,
  kind: LivestockKind | null,
): string | null {
  if (!row || kind === null || !row.ellenorizveAt) return null;
  if (Number.isNaN(row.ellenorizveAt.getTime())) return null;

  const facts: Record<string, unknown> = {};
  const put = (key: string, value: unknown): void => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value) && value.length === 0) return;
    facts[key] = value;
  };
  // a fixed key order: the same facts are the same text
  put("difficulty", row.careDifficulty);
  put("min_liter", numberOf(row.minLiter));
  put("maturity_months", row.medenceErettsegHonap);
  put("placement_zone", row.elhelyezesZona);
  put("reef_safe", row.reefSafe);
  put("reef_safe_reason", text(row.reefSafeIndok));
  put("social", row.socialKeeping);
  put("aggression", [...row.aggression]);
  put("coral_eater", row.korallevo);
  put("invertebrate_eater", row.gerinctelenevo);
  put("feeding", [...row.feedingType]);
  put("feeding_frequency", text(row.etetesGyakorisag));
  put("live_food", row.eloEleseg);
  put("light", row.fenyIgeny);
  put("flow", row.aramlasIgeny);
  // a size without what it measures is not a size (25 cm of arm span and 25 cm of body length are different animals)
  const size = numberOf(row.meretMax);
  if (size !== null && row.meretDimenzio)
    put("max_size", { value: size, dimension: row.meretDimenzio });
  put("sourcing", row.szarmazas);
  put("not_for", text(row.kinekNem));
  /*
    THE OPTIONAL FACTS, in a fixed order after the required ones. A RANGE goes only with BOTH ends: "24" and "at least 24" are not
    the same statement, and a one-sided range would be read as the first. A sting or venom flag goes out as it is stored, with the
    handling warning when there is one (the OS refuses to store a stated hazard without its warning; the projection does not
    hide a hazard it finds without one: a shown hazard is safer than a missing one).
  */
  const range = (
    low: { toString(): string } | number | null | undefined,
    high: { toString(): string } | number | null | undefined,
  ): { min: number; max: number } | null => {
    const min = numberOf(low ?? null);
    const max = numberOf(high ?? null);
    return min !== null && max !== null ? { min, max } : null;
  };
  put("temp_c", range(row.tempMinC, row.tempMaxC));
  put("salinity_sg", range(row.salinityMinSg, row.salinityMaxSg));
  put("kh_dkh", range(row.khMinDkh, row.khMaxDkh));
  put("lifespan_years", row.lifespanYears);
  put("sting_or_venom", row.stingOrVenom);
  put("handling_warning", text(row.handlingWarning ?? null));
  put("quarantine_weeks", row.quarantineWeeks);
  put("acclimatization", text(row.acclimatization ?? null));
  put("breeds_in_tank", row.breedsInTank);

  // a verified block with no fact to say says nothing
  if (Object.keys(facts).length === 0) return null;
  return JSON.stringify({
    v: HUSBANDRY_VERSION,
    kind: KIND_NAMES[kind],
    verified_on: row.ellenorizveAt.toISOString().slice(0, 10),
    ...facts,
  });
}
