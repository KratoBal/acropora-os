/**
 * PHOSPHATE CONCENTRATION UNITS: deterministic conversion between the units
 * research and the hobby actually use (research knowledge base, plan v4,
 * section 6 "Mértékegység", slice S1).
 *
 * Research mostly reports µmol/l, hobby test kits mg/l PO4, and some kits
 * mg/l P. Mixing these up is not a rounding error: 1 mg/l P is 3.07 mg/l PO4,
 * so reading a P value as PO4 understates it threefold. The conversion is
 * therefore code, never a model, and every mass unit carries its chemical
 * basis explicitly.
 *
 * === THE CONSTANTS ===
 *
 * Atomic weights come from `ATOMIC_WEIGHT` in `reef-chemistry.ts` (IUPAC 2021,
 * three decimals): P = 30.974, O = 15.999, so PO4 = 30.974 + 4 x 15.999 =
 * 94.970 g/mol. Cross-checks by hand:
 *   1 µmol/l  = 94.970 µg/l PO4 = 0.0950 mg/l PO4 = 0.0310 mg/l P
 *   1 mg/l P  = 94.970 / 30.974 = 3.066 mg/l PO4
 *
 * === MOLAR UNITS HAVE NO BASIS ===
 *
 * One phosphate ion contains exactly one phosphorus atom, so "1 µmol/l PO4"
 * and "1 µmol/l P" are the same amount. The basis only changes the number
 * for mass units (mg/l, µg/l and their ppm/ppb spellings).
 *
 * === ppm AND ppb ===
 *
 * Read as mg/l and µg/l, the way hobby test kits print them. Strictly, ppm by
 * mass in seawater is mg/kg, about 2.5% off mg/l at density 1.025; that is
 * below the resolution of any phosphate kit, and the kits themselves use the
 * volumetric meaning.
 */

import { ATOMIC_WEIGHT } from "./reef-chemistry.js";

export type PhosphateUnit = "µmol/l" | "mg/l" | "µg/l" | "ppm" | "ppb";
export type PhosphateBasis = "PO4" | "P";

export interface PhosphateConcentration {
  value: number;
  unit: PhosphateUnit;
  /** Required for every unit; ignored for µmol/l (see the file header). */
  basis: PhosphateBasis;
}

/** g/mol for each basis, from the shared atomic weights. */
export const PHOSPHATE_MOLAR_MASS: Readonly<Record<PhosphateBasis, number>> = {
  P: ATOMIC_WEIGHT.P,
  PO4: ATOMIC_WEIGHT.P + 4 * ATOMIC_WEIGHT.O,
};

/** µg per litre for one unit of the given mass unit. */
const MICROGRAMS_PER_UNIT: Readonly<
  Record<Exclude<PhosphateUnit, "µmol/l">, number>
> = {
  "mg/l": 1000,
  ppm: 1000,
  "µg/l": 1,
  ppb: 1,
};

/**
 * Spellings seen in papers and on test kits, mapped to the canonical unit.
 * Both the micro sign (U+00B5) and the Greek mu (U+03BC) are accepted, and
 * "u" as the ASCII stand-in. Anything else is unknown, not guessed.
 */
const UNIT_SPELLINGS: Readonly<Record<string, PhosphateUnit>> = (() => {
  const map: Record<string, PhosphateUnit> = {};
  for (const mu of ["µ", "μ", "u"]) {
    for (const l of ["l", "L"]) {
      map[`${mu}mol/${l}`] = "µmol/l";
      map[`${mu}g/${l}`] = "µg/l";
    }
    map[`${mu}M`] = "µmol/l";
  }
  map["mg/l"] = "mg/l";
  map["mg/L"] = "mg/l";
  map["ppm"] = "ppm";
  map["ppb"] = "ppb";
  return map;
})();

/** The canonical unit for a spelling, or `null` if it is not a phosphate unit we know. */
export function parsePhosphateUnit(spelling: string): PhosphateUnit | null {
  return UNIT_SPELLINGS[spelling.normalize("NFC").trim()] ?? null;
}

function toMicromolar(q: PhosphateConcentration): number {
  if (!Number.isFinite(q.value) || q.value < 0)
    throw new RangeError(
      `phosphate concentration must be a finite non-negative number, got ${q.value}`,
    );
  if (q.unit === "µmol/l") return q.value;
  return (
    (q.value * MICROGRAMS_PER_UNIT[q.unit]) / PHOSPHATE_MOLAR_MASS[q.basis]
  );
}

/** Converts a concentration to another unit and basis. */
export function convertPhosphate(
  q: PhosphateConcentration,
  unit: PhosphateUnit,
  basis: PhosphateBasis,
): number {
  const micromolar = toMicromolar(q);
  if (unit === "µmol/l") return micromolar;
  return (micromolar * PHOSPHATE_MOLAR_MASS[basis]) / MICROGRAMS_PER_UNIT[unit];
}

/** The knowledge base's comparison form: mg/l PO4. */
export function toMgPerLitrePo4(q: PhosphateConcentration): number {
  return convertPhosphate(q, "mg/l", "PO4");
}
