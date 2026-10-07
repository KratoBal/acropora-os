/**
 * AZ R1 ELŐSZABÁLY A PÁROSÍTÁSI JAVASLATRA (kártya e34247c0; barracuda mérése,
 * `agents/barracuda/megosztas/jev-eloszabaly-meres-2026-10-06.md`; acrobot 27201).
 *
 * A Jev által VÁLASZTOTT számla csak akkor látszhat javaslatként, ha legalább EGY
 * ponton egyezik a terheléssel:
 *
 *   - az összeg 5 Ft-on belül (azonos pénznemben, vagy az EUR-eredeti), VAGY
 *   - hasonló a szállító neve.
 *
 * Azt fogja meg, amikor egy MÁS cégtől jön egy KÖZELI összegű számla (Tesla ->
 * Yettel, Vízművek -> V+3B; 0,84 és 0,88 közötti bizonyossággal, tehát a küszöb
 * önmagában nem szűrte ki őket). A mért halmazokon a 0,8-as küszöbbel 55 jó és 3
 * rossz helyett 52 jó és 0 rossz, jót nem vesz el.
 *
 * EZ A PYTHON MÉRŐ PONTOS MÁSA (`agents/barracuda/scripts/jev-eloszabaly-meres.py`,
 * `norm`, `similar`, `eur`, `r1`), és ez nem lustaság: a mért szám arra a
 * szabályra igaz, ami ott fut. Egy „jobb” név-összevetés itt egy MÁSIK, nem
 * mért szabály lenne. A párhuzamot a teszt a mért példákon tartja.
 */
import type { PairCandidate, PairPayment } from "./pairing.js";

/** A cégforma és a gyakori szavak, amik nem különböztetnek meg két szállítót. */
const GENERIC_WORDS = [
  "kft",
  "zrt",
  "nyrt",
  "bt",
  "kkt",
  "gmbh",
  "ltd",
  "inc",
  "hungary",
  "hungaria",
  "magyarorszag",
  "korlatolt",
  "felelossegu",
  "tarsasag",
  "zartkoruen",
  "mukodo",
  "reszvenytarsasag",
  "simplep",
  "barionp",
  "szaml",
];
const GENERIC = new RegExp(`\\b(${GENERIC_WORDS.join("|")})\\b`, "g");

/** Kisbetű, ékezet nélkül (a Python `plain`). */
function plain(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "");
}

/** A név szavai, írásjel és cégforma nélkül (a Python `norm`). */
function words(value: string): string[] {
  return plain(value)
    .replace(/[^\p{L}\p{N}_ ]/gu, " ")
    .replace(GENERIC, " ")
    .split(/\s+/)
    .filter((word) => word !== "");
}

/**
 * HASONLÓ-E A KÉT NÉV: van közös, legalább 4 betűs szavuk, vagy az első szavuk
 * első 5 betűje azonos. (A mérő szerint egy hasonlósági arány a rövid neveken
 * túl engedékeny volt: „tesla” és „yettel” 0,55.)
 */
export function similarSupplierName(a: string, b: string): boolean {
  const x = words(a);
  const y = words(b);
  if (x.length === 0 || y.length === 0) return false;
  const long = new Set(x.filter((word) => word.length >= 4));
  return (
    y.some((word) => word.length >= 4 && long.has(word)) ||
    (x[0]!.length >= 5 && x[0]!.slice(0, 5) === y[0]!.slice(0, 5))
  );
}

/** Az EUR-eredeti összeg a terhelés „original” mezőjéből („12.34 EUR”). */
function eurOriginal(payment: PairPayment): number | null {
  const match = /([\d.]+)\s*EUR/.exec(payment.original ?? "");
  return match ? Number(match[1]) : null;
}

export function pairRuleR1(
  payment: PairPayment,
  candidate: PairCandidate,
): boolean {
  const amount =
    candidate.currency === payment.currency
      ? Number(payment.amount)
      : candidate.currency === "EUR"
        ? eurOriginal(payment)
        : null;
  const gross = candidate.gross === "" ? Number.NaN : Number(candidate.gross);
  const exact =
    amount !== null &&
    Number.isFinite(amount) &&
    Number.isFinite(gross) &&
    Math.abs(gross - amount) <= 5;
  return exact || similarSupplierName(payment.partner, candidate.supplier);
}
