import { Prisma } from "@acropora/database";

/**
 * KÉT KÜLÖNBÖZŐ FORINT-ALAK, MERT A MINTA-LAPON IS KETTŐ ÁLL.
 *
 * A `exchange/minta-megrendelolap-allatkert.docx` táblázatában szóközös
 * ezres-tagolás áll, tizedesjegy nélkül ("410 000 Ft"), az összesítő sorokban
 * viszont pontos tagolás, ",- Ft" végződéssel ("7.302.500,- Ft"). Ez a
 * KÜLÖNBSÉG az ÜGYFÉL saját lapján is megvan (nem a mi találmányunk), és mivel
 * a lap az ő formátumukat követi, mind a két alak szükséges -- nem elég egyet
 * választani és mindenhol azt használni.
 *
 * A FORINT EGÉSZ SZÁMRA KEREKÍT: a mintán egyetlen fillér sem szerepel, és a
 * karbantartási tételek árazása is egész forintban áll.
 */

function roundedForintDigits(value: Prisma.Decimal): string {
  return value.toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toFixed(0);
}

/** "410 000 Ft" -- szóközös ezres tagolás, a táblázat celláihoz. */
export function formatOrderFormTableAmount(value: Prisma.Decimal): string {
  const digits = roundedForintDigits(value);
  const negative = digits.startsWith("-");
  const grouped = groupThousands(negative ? digits.slice(1) : digits, " ");
  return `${negative ? "-" : ""}${grouped} Ft`;
}

/** "7.302.500,- Ft" -- pontos ezres tagolás, az összesítő sorokhoz. */
export function formatOrderFormSummaryAmount(value: Prisma.Decimal): string {
  const digits = roundedForintDigits(value);
  const negative = digits.startsWith("-");
  const grouped = groupThousands(negative ? digits.slice(1) : digits, ".");
  return `${negative ? "-" : ""}${grouped},- Ft`;
}

function groupThousands(digits: string, separator: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
}

/**
 * "kelt" DÁTUMA, YYYY-MM-DD ALAKBAN -- ugyanaz az alak, mint a munkalap
 * `sheetDate()`-je ad a csupasz napi mezőkre, hogy a generált dokumentumok
 * dátumformátuma egységes legyen a repóban.
 */
export function formatOrderFormDate(isoDate: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate;
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toISOString().slice(0, 10);
}
