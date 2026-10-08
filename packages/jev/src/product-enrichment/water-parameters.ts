/**
 * THE WATER PARAMETERS A PRODUCT MOVES (the water-measurement recommendation,
 * card 2b3983e1, decided by acrobot 28437 under Balázs's 2026-10-08 21:14 UTC
 * approval). The codes are the aquarium measurement's codes letter for letter
 * (`AQUARIUM_MEASUREMENT_PARAMETERS` in `@acropora/types`), so a measured
 * deviation and a product's effect meet on the same key. The list lives here
 * because this package cannot import `@acropora/types` at run time; a test pins
 * that the two lists are equal.
 */
export const WATER_PARAMETER_CODES = [
  "HOMERSEKLET",
  "SOTARTALOM",
  "SURUSEG",
  "PH",
  "KH",
  "GH",
  "KALCIUM",
  "MAGNEZIUM",
  "NITRAT",
  "FOSZFAT",
  "AMMONIA",
  "NITRIT",
  "SZILIKAT",
  "ORP",
  "VAS",
  "REZ",
  "VEZETOKEPESSEG",
] as const;
export type WaterParameterCode = (typeof WATER_PARAMETER_CODES)[number];

/** Raises (`EMEL`) or lowers (`CSOKKENT`) the parameter. */
export const WATER_PARAMETER_DIRECTIONS = ["EMEL", "CSOKKENT"] as const;
export type WaterParameterDirection =
  (typeof WATER_PARAMETER_DIRECTIONS)[number];

export interface WaterParameterEffect {
  code: WaterParameterCode;
  direction: WaterParameterDirection;
}

const isCode = (v: string): v is WaterParameterCode =>
  (WATER_PARAMETER_CODES as readonly string[]).includes(v);
const isDirection = (v: string): v is WaterParameterDirection =>
  (WATER_PARAMETER_DIRECTIONS as readonly string[]).includes(v);

/**
 * `KALCIUM:EMEL; kh:emel` -> the canonical `KALCIUM:EMEL;KH:EMEL`: pairs
 * separated by `;` or `,`, each `CODE:DIRECTION`, case and spacing free, sorted
 * by code, a repeated pair once. Two sources agree exactly when their canonical
 * sets are equal, so one source saying "calcium" and another "calcium and
 * magnesium" is a conflict for a human, never a merged fact.
 *
 * Refused: an empty value, an unknown code or direction, and one code in both
 * directions (a product does not raise and lower the same parameter).
 */
export function parseWaterParameterEffects(
  raw: string,
):
  | { ok: true; effects: WaterParameterEffect[]; canonical: string }
  | { ok: false; reason: string } {
  const parts = raw
    .split(/[;,]/)
    .map((p) => p.trim())
    .filter((p) => p !== "");
  if (parts.length === 0) return { ok: false, reason: "empty" };
  const byCode = new Map<WaterParameterCode, WaterParameterDirection>();
  for (const part of parts) {
    const [codeRaw, directionRaw, ...rest] = part
      .split(":")
      .map((s) => s.trim().toUpperCase());
    if (!codeRaw || !directionRaw || rest.length > 0)
      return { ok: false, reason: `"${part}": not CODE:DIRECTION` };
    if (!isCode(codeRaw))
      return { ok: false, reason: `"${codeRaw}": not a measurement code` };
    if (!isDirection(directionRaw))
      return {
        ok: false,
        reason: `"${directionRaw}": the direction is EMEL or CSOKKENT`,
      };
    const before = byCode.get(codeRaw);
    if (before && before !== directionRaw)
      return { ok: false, reason: `${codeRaw}: both directions` };
    byCode.set(codeRaw, directionRaw);
  }
  const effects = [...byCode]
    .map(([code, direction]) => ({ code, direction }))
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  return {
    ok: true,
    effects,
    canonical: effects.map((e) => `${e.code}:${e.direction}`).join(";"),
  };
}
