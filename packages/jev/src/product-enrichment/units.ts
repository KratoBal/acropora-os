/**
 * Unit normalization for Tier C quantities: flow, power, voltage, volume,
 * length and mass.
 *
 * The parser accepts exactly ONE positive number and ONE known unit, and
 * nothing else. Everything a human would have to interpret is rejected with
 * a reason, because a guess here becomes a "verified" spec on a product page:
 *
 *   - no unit ("3000"): which unit?
 *   - a range or a multiple ("2000-3000 l/h", "2 x 24 W", "100-240 V");
 *   - a qualifier ("max. 3000 l/h", "~25 W", "approx. 5 kg"): nominal or peak?
 *   - a separator followed by exactly three digits ("1.500 l/h", "1,500 l/h"):
 *     1.5 or 1500 depends on the writer's locale, so neither is assumed.
 *     "0.250 kg" is allowed: a leading zero cannot be a thousands group.
 *   - an unknown unit, or a unit of another dimension than the field's.
 *
 * Conversion is exact decimal arithmetic (every factor is a power of ten), so
 * "1.1 l" is "1100" ml, never "1100.0000000000002".
 */

export type Dimension =
  "flow" | "power" | "voltage" | "volume" | "length" | "mass";

export const CANONICAL_UNIT: Record<Dimension, string> = {
  flow: "l/h",
  power: "W",
  voltage: "V",
  volume: "ml",
  length: "mm",
  mass: "g",
};

/** Unit spelling -> dimension and power-of-ten factor to the canonical unit. */
const UNITS: Record<string, { dimension: Dimension; exponent: number }> = {
  "l/h": { dimension: "flow", exponent: 0 },
  "L/h": { dimension: "flow", exponent: 0 },
  lph: { dimension: "flow", exponent: 0 },
  "l/óra": { dimension: "flow", exponent: 0 },
  "m3/h": { dimension: "flow", exponent: 3 },
  "m³/h": { dimension: "flow", exponent: 3 },
  W: { dimension: "power", exponent: 0 },
  kW: { dimension: "power", exponent: 3 },
  V: { dimension: "voltage", exponent: 0 },
  ml: { dimension: "volume", exponent: 0 },
  mL: { dimension: "volume", exponent: 0 },
  l: { dimension: "volume", exponent: 3 },
  L: { dimension: "volume", exponent: 3 },
  mm: { dimension: "length", exponent: 0 },
  cm: { dimension: "length", exponent: 1 },
  m: { dimension: "length", exponent: 3 },
  g: { dimension: "mass", exponent: 0 },
  kg: { dimension: "mass", exponent: 3 },
};

export type QuantityResult =
  | {
      ok: true;
      dimension: Dimension;
      /** Exact decimal string in the canonical unit, no trailing zeros. */
      amount: string;
      unit: string;
      /** Voltage only: "AC" or "DC" when the source states it. */
      current?: "AC" | "DC";
      /** The comparison form: `"3000 l/h"`, `"12 V DC"`. */
      canonical: string;
    }
  | { ok: false; reason: string };

const GROUP_SPACE = "[ \\u00a0\\u2009\\u202f]";
const NUMBER = `(\\d{1,3}(?:${GROUP_SPACE}\\d{3})+|\\d+)(?:([.,])(\\d+))?`;
const QUANTITY = new RegExp(`^${NUMBER}\\s*(\\S+?)(?:\\s+(AC|DC))?$`);

export function parseQuantity(
  raw: string,
  expected: Dimension,
): QuantityResult {
  const text = raw.normalize("NFC").trim().replace(/\s+/g, " ");
  if (text === "") return { ok: false, reason: "empty" };

  if (
    /(^|\s)(~|ca\.?|kb\.?|approx\.?|max\.?|min\.?|up to|akár)(\s|$)|[~<>≤≥±]/i.test(
      text,
    )
  )
    return { ok: false, reason: "qualified value (max/min/approx): ambiguous" };
  if (/\d\s*[-–—]\s*\d|\d\s*(x|×|\*)\s*\d|\/\s*\d/i.test(text))
    return { ok: false, reason: "range or multiple values: ambiguous" };
  if (/^[\d\s.,\u00a0\u2009\u202f]+$/.test(text))
    return { ok: false, reason: "no unit" };

  const m = QUANTITY.exec(text);
  if (!m)
    return { ok: false, reason: "not a single number followed by a unit" };
  const [, intRaw = "", separator, fraction, unitRaw = "", current] = m;

  const unit = UNITS[unitRaw];
  if (!unit) return { ok: false, reason: `unknown unit "${unitRaw}"` };
  if (unit.dimension !== expected)
    return {
      ok: false,
      reason: `unit "${unitRaw}" is ${unit.dimension}, the field expects ${expected}`,
    };
  if (current && expected !== "voltage")
    return { ok: false, reason: `${current} only applies to a voltage` };

  const intDigits = intRaw.replace(/\D/g, "");
  if (separator && fraction?.length === 3 && !/^0+$/.test(intDigits))
    return {
      ok: false,
      reason: `"${intRaw}${separator}${fraction}" may be a decimal or a thousands group: ambiguous`,
    };

  const amount = scaleDecimal(intDigits, fraction ?? "", unit.exponent);
  if (/^0(\.0+)?$/.test(amount))
    return { ok: false, reason: "zero is not a measured value" };

  const canonicalUnit = CANONICAL_UNIT[expected];
  return {
    ok: true,
    dimension: expected,
    amount,
    unit: canonicalUnit,
    ...(current ? { current: current as "AC" | "DC" } : {}),
    canonical: `${amount} ${canonicalUnit}${current ? ` ${current}` : ""}`,
  };
}

/** `int.fraction` × 10^exponent as an exact decimal string. */
function scaleDecimal(int: string, fraction: string, exponent: number): string {
  const digits = BigInt(int + fraction);
  const scale = fraction.length - exponent;
  if (scale <= 0) return (digits * 10n ** BigInt(-scale)).toString();
  const s = digits.toString().padStart(scale + 1, "0");
  const whole = s.slice(0, -scale);
  const frac = s.slice(-scale).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

/**
 * A DOSING INSTRUCTION: an amount per water volume per period, e.g. the
 * manufacturer's "1 Tropfen je 100 Liter /Tag" entered as `1 drop/100 L/day`.
 *
 * Accepted forms (the evidence value a reviewer types, not the page text;
 * the verbatim page text travels separately as the excerpt):
 *
 *   1 drop/100 L/day            once per period
 *   5 ml/100 L/week             a volume amount (ml or l)
 *   1 drop/100 L, 1-2/week      a frequency, or a frequency range, per period
 *
 * The amount is a count of drops or a volume; the water volume is a volume;
 * the period is a day or a week. Like `parseQuantity`, anything a human
 * would have to interpret is rejected: a range in the amount ("1-2 drop"),
 * a qualifier ("max."), an unknown unit or period, an ambiguous thousands
 * group. Only the FREQUENCY may be a range, because that is how the 2013
 * dosage table states the manufacturer's own regime.
 *
 * Canonical form: drops as `drop`, a volume amount in `ml`, the water volume
 * in `L`, and a frequency of exactly 1 folded into the plain form, so
 * `1 drop/100 L, 1/day` and `1 drop/100 L/day` are the same value.
 */
export type DoseResult =
  | {
      ok: true;
      amount: string;
      unit: "drop" | "ml";
      perVolumeLitres: string;
      frequency: { min: number; max: number };
      period: "day" | "week";
      canonical: string;
    }
  | { ok: false; reason: string };

const DOSE_AMOUNT_UNITS: Record<string, "drop" | "ml" | "l"> = {
  drop: "drop",
  drops: "drop",
  ml: "ml",
  mL: "ml",
  l: "l",
  L: "l",
};
const DOSE_PERIODS: Record<string, "day" | "week"> = {
  day: "day",
  d: "day",
  week: "week",
  wk: "week",
};
const DOSE_NUMBER = "(\\d+)(?:([.,])(\\d+))?";
const DOSE = new RegExp(
  `^${DOSE_NUMBER}\\s*([A-Za-z]+)\\s*\\/\\s*${DOSE_NUMBER}\\s*([A-Za-z]+)\\s*` +
    `(?:\\/\\s*([A-Za-z]+)|,\\s*(\\d+)(?:\\s*-\\s*(\\d+))?\\s*\\/\\s*([A-Za-z]+))$`,
);

export function parseDose(raw: string): DoseResult {
  const text = raw.normalize("NFC").trim().replace(/\s+/g, " ");
  if (text === "") return { ok: false, reason: "empty" };
  if (
    /(^|\s)(~|ca\.?|approx\.?|max\.?|min\.?|up to)(\s|$)|[~<>≤≥±]/i.test(text)
  )
    return { ok: false, reason: "qualified value (max/min/approx): ambiguous" };

  const m = DOSE.exec(text);
  if (!m)
    return {
      ok: false,
      reason:
        'not a dose: expected "<amount> drop|ml/<volume> L/day|week" or "..., <n>[-<m>]/day|week"',
    };
  const [
    ,
    amountInt = "",
    amountSep,
    amountFrac,
    amountUnitRaw = "",
    perInt = "",
    perSep,
    perFrac,
    perUnitRaw = "",
    plainPeriod,
    freqMin,
    freqMax,
    freqPeriod,
  ] = m;

  const amountUnit = DOSE_AMOUNT_UNITS[amountUnitRaw];
  if (!amountUnit)
    return { ok: false, reason: `unknown dose unit "${amountUnitRaw}"` };
  const perUnit = UNITS[perUnitRaw];
  if (!perUnit || perUnit.dimension !== "volume")
    return {
      ok: false,
      reason: `the water volume needs a volume unit, got "${perUnitRaw}"`,
    };
  const periodRaw = plainPeriod ?? freqPeriod ?? "";
  const period = DOSE_PERIODS[periodRaw.toLowerCase()];
  if (!period) return { ok: false, reason: `unknown period "${periodRaw}"` };

  for (const [int, sep, frac] of [
    [amountInt, amountSep, amountFrac],
    [perInt, perSep, perFrac],
  ] as const)
    if (sep && frac?.length === 3 && !/^0+$/.test(int))
      return {
        ok: false,
        reason: `"${int}${sep}${frac}" may be a decimal or a thousands group: ambiguous`,
      };

  if (amountUnit === "drop" && amountFrac)
    return { ok: false, reason: "a number of drops is a whole number" };
  const amount =
    amountUnit === "drop"
      ? scaleDecimal(amountInt, "", 0)
      : scaleDecimal(amountInt, amountFrac ?? "", amountUnit === "l" ? 3 : 0);
  // The water volume in litres: ml is 10^-3 of a litre, a litre is itself.
  const perVolumeLitres = scaleDecimal(
    perInt,
    perFrac ?? "",
    perUnit.exponent - 3,
  );
  if (/^0(\.0+)?$/.test(amount) || /^0(\.0+)?$/.test(perVolumeLitres))
    return { ok: false, reason: "zero is not a dose" };

  const min = freqMin === undefined ? 1 : Number(freqMin);
  const max = freqMax === undefined ? min : Number(freqMax);
  if (min < 1) return { ok: false, reason: "a frequency starts at 1" };
  if (max < min)
    return { ok: false, reason: `frequency range ${min}-${max} is reversed` };

  const unit = amountUnit === "drop" ? "drop" : "ml";
  const base = `${amount} ${unit}/${perVolumeLitres} L`;
  const canonical =
    min === 1 && max === 1
      ? `${base}/${period}`
      : `${base}, ${min === max ? min : `${min}-${max}`}/${period}`;
  return {
    ok: true,
    amount,
    unit,
    perVolumeLitres,
    frequency: { min, max },
    period,
    canonical,
  };
}
