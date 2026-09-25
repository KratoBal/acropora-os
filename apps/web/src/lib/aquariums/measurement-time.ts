/**
 * A "MÉRÉS IDEJE" MEZŐ ÁTVÁLTÁSA A `datetime-local` INPUT ÉS A `Date` KÖZÖTT.
 *
 * A `datetime-local` a HELYI időt viszi, ÉV-HÓ-NAP"T"ÓRA:PERC alakban, UTC
 * eltolás nélkül -- a csapda ugyanaz, mint a mobil `dateInputValue`-jánál
 * (`apps/mobile/src/lib/assets/asset-create.ts`): a `toISOString()` UTC-ben
 * ír, tehát egy budapesti este 23 órás mérés UTC-ben már a KÖVETKEZŐ napra
 * esne, ha a helyi év/hónap/nap/óra/perc hármas helyett azt olvasnánk ki.
 */
function pad(value: number, length: number): string {
  return value.toString().padStart(length, "0");
}

export function toDatetimeLocalValue(date: Date): string {
  return (
    `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1, 2)}-` +
    `${pad(date.getDate(), 2)}T${pad(date.getHours(), 2)}:` +
    `${pad(date.getMinutes(), 2)}`
  );
}

/** `null`, ha a böngésző üresen vagy értelmezhetetlen szöveggel adta vissza. */
export function fromDatetimeLocalValue(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number);
  const date = new Date(year!, month! - 1, day!, hour, minute, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}
