/**
 * NETTÓ ÉS BRUTTÓ EGYSÉGÁR EGYMÁSBÓL (Luca, 2026-11-13: „mezei bolti vásárlónak készített árajánlatnál
 * nem szoktam nettó árral számolni"). A tétel továbbra is NETTÓ egységárat tárol (`QuoteItem.unitNetPrice`,
 * négy tizedes), a bruttó csak a beviteli felület: a bruttóból az ÁFA-kulccsal visszaszámolt nettó megy el.
 *
 * Egész számokkal (BigInt) számol, nem lebegőpontosan: az ár és a kulcs szöveges, és egy 0,1 + 0,2 típusú
 * eltérés itt egy forintot mozdíthat. A kerekítés fél felfelé (ahogy a forint kerekítése megszokott).
 * Az eredmény kerekítéséről: egy bruttó ár egész forintra vagy fillérre akkor adja vissza ugyanazt, ha a
 * nettó négy tizedese elég; nagy mennyiségnél (több ezer darab) a négy tizedes eltérése már fillért
 * mozdíthat, ezért a nettó mező mellett a bruttó is látszik, és a felhasználó azt látja, amit beírt.
 */

const SCALE = 6n;
const ONE = 10n ** SCALE;

/** `12,5` vagy `12.5` -> 12 500 000 (hat tizedes); más alak (betű, két pont, előjel nélküli üres) null. */
function parseScaled(text: string): bigint | null {
  const match = /^(-?)(\d+)(?:[.,](\d+))?$/.exec(text.trim());
  if (!match) return null;
  const [, sign, whole, fraction = ""] = match;
  const digits = fraction.padEnd(Number(SCALE), "0").slice(0, Number(SCALE));
  const value = BigInt(whole!) * ONE + BigInt(digits);
  return sign ? -value : value;
}

/** Fél felfelé (a nullától távolodva) kerekített egész osztás. */
function divideRounded(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const quotient = (2n * n + d) / (2n * d);
  return negative ? -quotient : quotient;
}

/** Az `1234500` (két tizedes) szöveggé: `12.35`; a záró nullák nélkül, így `12.3`, `12`. */
function format(scaled: bigint, decimals: number): string {
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const fraction = (abs % base).toString().padStart(decimals, "0");
  const trimmed = fraction.replace(/0+$/, "");
  const sign = negative && (whole !== 0n || trimmed) ? "-" : "";
  return `${sign}${whole}${trimmed ? `.${trimmed}` : ""}`;
}

/** A bruttó egységár a nettóból és az ÁFA %-ból, két tizedesre; `null`, ha valamelyik nem szám. */
export function grossFromNet(net: string, vatPercent: string): string | null {
  const n = parseScaled(net);
  const v = parseScaled(vatPercent);
  if (n === null || v === null) return null;
  // bruttó * 100 (két tizedes) = nettó * (100 + áfa) / 100 * 100
  return format(divideRounded(n * (100n * ONE + v), ONE * ONE), 2);
}

/** A nettó egységár a bruttóból és az ÁFA %-ból, négy tizedesre (a tárolt pontosság); `null`, ha nem szám. */
export function netFromGross(gross: string, vatPercent: string): string | null {
  const g = parseScaled(gross);
  const v = parseScaled(vatPercent);
  if (g === null || v === null) return null;
  const divisor = 100n * ONE + v;
  if (divisor <= 0n) return null;
  // nettó * 10^4 = bruttó * 100 / (100 + áfa) * 10^4
  return format(divideRounded(g * 100n * 10n ** 4n, divisor), 4);
}
