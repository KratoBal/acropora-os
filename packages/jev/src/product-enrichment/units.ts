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
