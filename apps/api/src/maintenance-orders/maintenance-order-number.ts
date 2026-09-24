/**
 * A MEGRENDELŐLAP SZÁMA: UGYANAZ A LOGIKA, MINT A HIBAJEGYÉ, MÁS ELŐTAG.
 *
 * `MR-2026-001` alakú: évenkénti, cégszintű sorszám, ugyanúgy, mint a
 * `service-job-number.ts` `HJ-`-je és a munkalap `formatWorksheetNumber`-je.
 * NEM azonos a `Contract.number`-rel (az a szerződésé, ez a kiállításé), és
 * nem az ügyfél saját "Iktatási száma" mezőjével (az a vevőé, üresen megy ki
 * -- lásd `exchange/nautilus-megrendelolap-lekepezesi-terv-2026-09-24.md`).
 */
export const MAINTENANCE_ORDER_NUMBER_PREFIX = "MR";

const SEQUENCE_DIGITS = 3;

export function maintenanceOrderNumberPrefix(year: number): string {
  return `${MAINTENANCE_ORDER_NUMBER_PREFIX}-${year}-`;
}

/**
 * A következő szám az idei LEGNAGYOBB alapján -- lásd
 * `service-job-number.ts` `nextServiceJobNumber`-jét: egy nem értelmezhető
 * régi sorszám itt is HANGOSAN áll meg, nem csendben nullázza a számlálót.
 */
export function nextMaintenanceOrderNumber(input: {
  year: number;
  lastNumber: string | null;
}): string {
  const prefix = maintenanceOrderNumberPrefix(input.year);
  if (input.lastNumber === null)
    return `${prefix}${"1".padStart(SEQUENCE_DIGITS, "0")}`;

  const tail = input.lastNumber.slice(prefix.length);
  const parsed = Number(tail);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(
      `A legutolsó megrendelőlap-szám nem értelmezhető: ${input.lastNumber}`,
    );
  }
  return `${prefix}${String(parsed + 1).padStart(SEQUENCE_DIGITS, "0")}`;
}
