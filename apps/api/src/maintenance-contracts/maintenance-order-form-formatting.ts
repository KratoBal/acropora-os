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
 * "kelt" DÁTUMA, YYYY-MM-DD ALAKBAN, BUDAPESTI NAPTÁR SZERINT.
 *
 * === MIÉRT NEM `toISOString().slice(0, 10)` ===
 *
 * Az korábban itt állt, és UTC szerint vágott -- egy `2026-07-28T22:30:00Z`
 * bélyeg budapesti idő szerint (nyáron, CEST, UTC+2) MÁR MÁSNAP van, tehát a
 * levágás rossz napot írt volna egy alá- és visszaküldött megrendelőlapra.
 * Ugyanez a hiba állt a `worksheet-sheet-content.ts` saját `sheetDate()`-je
 * előtt is -- ez a mérce most már itt is él, ugyanazzal a technikával
 * (`Intl.DateTimeFormat` `Europe/Budapest` zónával), nem csak ott (nautilus
 * mérése, 2026-09-24, acrobot jelezte).
 *
 * Ami NEM dátum, azt változatlanul adjuk vissza: a bemenet egy része már ma
 * is csupasz nap (`2026-08-27`), és azon nincs mit átszámolni.
 */
const HU_DATE = new Intl.DateTimeFormat("hu-HU", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "Europe/Budapest",
});

export function formatOrderFormDate(isoDate: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate;
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return isoDate;
  return HU_DATE.format(date).replace(/\. /g, "-").replace(/\.$/, "");
}
