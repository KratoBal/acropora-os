import { parseWaterParameterEffects } from "@acropora/jev/product-enrichment";

/**
 * WHEN A DOSE-LIST ROW MAY FEED THE AUTOMATIC RECOMMENDATION (ReefClub plan
 * v6.1, 6.2; slice 7). A pure function: the row, what the JEV says about the
 * product, and whether the product can be bought. The recommendation (slice
 * 8) gives a dose only from a row with no refusal; the OS list shows the
 * refusals, so the colleague sees why a row is not live.
 *
 *   NO_SOURCE        the source is empty
 *   NOT_VERIFIED     no colleague has checked the current version
 *   SAME_COLLEAGUE   the one who checked it is the one who recorded it
 *   NO_MAX_DAILY     the manufacturer's daily maximum is not filled in
 *   JEV_DISAGREES    the JEV's set for the product does not hold this
 *                    parameter and direction (or the JEV has no usable set:
 *                    none, or conflicting sources)
 *   NOT_PURCHASABLE  the product cannot be bought (inactive, UNAS status not
 *                    1 or 2, or inquiry only)
 *   ARCHIVED         the row was withdrawn
 *
 * Any edit clears the verification (the service), so NOT_VERIFIED follows a
 * change of any number until a second colleague checks it again.
 */
export type DoseEffectRefusal =
  | "ARCHIVED"
  | "NO_SOURCE"
  | "NOT_VERIFIED"
  | "SAME_COLLEAGUE"
  | "NO_MAX_DAILY"
  | "JEV_DISAGREES"
  | "NOT_PURCHASABLE";

export interface DoseEffectRuleRow {
  parameterCode: string;
  direction: "EMEL" | "CSOKKENT";
  source: string;
  maxDailyDosePer100L: unknown | null;
  recordedById: string | null;
  verifiedById: string | null;
  archivedAt: Date | null;
}

/**
 * The JEV's water-effect value for a product: VERIFIED (the sources agree),
 * UNVERIFIED (only the shop's own data says it), CONFLICTING (the sources
 * disagree: never a basis), or NONE. The same reading as the internal
 * candidate source (`jev-candidate-source.ts`, `effectOf`).
 */
export interface JevEffectState {
  status: "VERIFIED" | "UNVERIFIED" | "CONFLICTING" | "NONE";
  effects: { parameterCode: string; direction: "EMEL" | "CSOKKENT" }[];
}

export function jevEffectState(
  row: {
    status: string;
    value: string | null;
    currentValue: string | null;
  } | null,
): JevEffectState {
  if (!row) return { status: "NONE", effects: [] };
  const text =
    row.status === "VERIFIED"
      ? row.value
      : row.status === "UNVERIFIED"
        ? row.currentValue
        : null;
  if (row.status === "CONFLICTING_SOURCES")
    return { status: "CONFLICTING", effects: [] };
  if (!text) return { status: "NONE", effects: [] };
  const parsed = parseWaterParameterEffects(text);
  if (!parsed.ok) return { status: "NONE", effects: [] };
  return {
    status: row.status === "VERIFIED" ? "VERIFIED" : "UNVERIFIED",
    effects: parsed.effects.map((effect) => ({
      parameterCode: effect.code,
      direction: effect.direction,
    })),
  };
}

export function doseEffectRefusals(
  row: DoseEffectRuleRow,
  context: { jev: JevEffectState; purchasable: boolean },
): DoseEffectRefusal[] {
  const refusals: DoseEffectRefusal[] = [];
  if (row.archivedAt) refusals.push("ARCHIVED");
  if (row.source.trim() === "") refusals.push("NO_SOURCE");
  if (!row.verifiedById) refusals.push("NOT_VERIFIED");
  else if (row.verifiedById === row.recordedById)
    refusals.push("SAME_COLLEAGUE");
  if (row.maxDailyDosePer100L === null) refusals.push("NO_MAX_DAILY");
  const agrees = context.jev.effects.some(
    (effect) =>
      effect.parameterCode === row.parameterCode &&
      effect.direction === row.direction,
  );
  if (!agrees) refusals.push("JEV_DISAGREES");
  if (!context.purchasable) refusals.push("NOT_PURCHASABLE");
  return refusals;
}
