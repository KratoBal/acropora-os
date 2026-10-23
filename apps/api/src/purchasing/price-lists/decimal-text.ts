/**
 * Exact decimal handling on text. Nothing here goes through `Number`.
 *
 * The column is `Decimal(19,4)`: a price with more than four decimals would be
 * rounded by the database without a word, so it is refused here instead.
 */

const MAX_DECIMALS = 4;

function normalize(integer: string, fraction: string): string | null {
  // zeros at the end add nothing (1.23450 is exactly 1.2345), so they are cut first
  const frac = fraction.replace(/0+$/, "");
  if (frac.length > MAX_DECIMALS) return null;
  const whole = integer.replace(/^0+(?=\d)/, "");
  return frac === "" ? whole : `${whole}.${frac}`;
}

/** "30.65" -> "30.65"; "4.10" -> "4.1"; anything else (a comma, a sign, a space inside) -> null. */
export function parseDotDecimal(text: string): string | null {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text.trim());
  return match ? normalize(match[1]!, match[2] ?? "") : null;
}

/**
 * A dot decimal as a SPREADSHEET EXPORT writes it. The De Jong stocklist holds
 * 575 of its 7075 prices as binary-float noise (`138.88999999999999`,
 * `287.04000000000002`, `74.069999999999993`): the sheet's double printed with
 * 17 significant digits. Read strictly that is five or more decimals and would
 * be refused; the intended price is the one a double of 15 significant digits
 * stands for (`138.89`).
 *
 * This is NOT rounding. The text is accepted only when ALL of these hold: it
 * has more than four decimals, at least 15 significant digits (so a genuine
 * `1.23456` is still refused), and the 15-digit form has at most four decimals
 * AND lies within four units in the last place of the printed double. A price that fails any of them
 * returns null, the same as the strict reader.
 */
export function parseSpreadsheetDotDecimal(text: string): string | null {
  const strict = parseDotDecimal(text);
  if (strict !== null) return strict;
  const trimmed = text.trim();
  const match = /^(\d+)\.(\d+)$/.exec(trimmed);
  if (!match) return null;
  const significant = (match[1]! + match[2]!).replace(/^0+/, "").length;
  if (match[2]!.length <= MAX_DECIMALS || significant < 15) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  const short = value.toPrecision(15);
  // the cleaned price must be within a few units in the last place of the printed value (noise left by
  // a spreadsheet's arithmetic is one or two ulp off, e.g. 1.9300000000000002 for 1.93); a genuinely
  // different number such as 123456789012.12345 is orders of magnitude further away
  if (/e/i.test(short) || Math.abs(Number(short) - value) > Math.abs(value) * 4 * Number.EPSILON)
    return null;
  return parseDotDecimal(short);
}

/**
 * "45,75" -> "45.75"; "1.234,56" -> "1234.56" (dots only as thousands
 * separators in groups of three). A bare "1.234" is NOT read here: it could be
 * a dot decimal, and a guess about money is worse than a rejected row.
 */
export function parseCommaDecimal(text: string): string | null {
  const trimmed = text.trim();
  const plain = /^(\d+)(?:,(\d+))?$/.exec(trimmed);
  if (plain) return normalize(plain[1]!, plain[2] ?? "");
  const grouped = /^(\d{1,3}(?:\.\d{3})+),(\d+)$/.exec(trimmed);
  return grouped ? normalize(grouped[1]!.replace(/\./g, ""), grouped[2]!) : null;
}

/** Compares two normalized decimal strings exactly: negative if a < b, 0 if equal, positive if a > b. */
export function compareDecimal(a: string, b: string): number {
  const [aInt = "0", aFrac = ""] = a.split(".");
  const [bInt = "0", bFrac = ""] = b.split(".");
  const scale = Math.max(aFrac.length, bFrac.length);
  const left = BigInt(aInt + aFrac.padEnd(scale, "0"));
  const right = BigInt(bInt + bFrac.padEnd(scale, "0"));
  return left < right ? -1 : left > right ? 1 : 0;
}
