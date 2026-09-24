/**
 * A TELJESÍTÉSI IGAZOLÁS SZÁMA: UGYANAZ A LOGIKA, MINT A MEGRENDELŐLAPÉ ÉS A
 * HIBAJEGYÉ, MÁS ELŐTAG.
 *
 * `TI-2026-001` alakú -- évenkénti, cégszintű sorszám, ugyanúgy, mint a
 * `service-job-number.ts` `HJ-`-je és a `maintenance-order-number.ts` `MR-`-je.
 * A MINTA (`exchange/minta-teljesitesi-igazolas-allatkert.pdf`) "ÁLT #2026-12"
 * alakja a RÉGI, külső programból jött -- ezt a rendszer mostantól SAJÁT
 * sorszámmal állítja ki, a többi generált dokumentumunkéval egyező alakban.
 */
export const COMPLETION_CERTIFICATE_NUMBER_PREFIX = "TI";

const SEQUENCE_DIGITS = 3;

export function completionCertificateNumberPrefix(year: number): string {
  return `${COMPLETION_CERTIFICATE_NUMBER_PREFIX}-${year}-`;
}

export function nextCompletionCertificateNumber(input: {
  year: number;
  lastNumber: string | null;
}): string {
  const prefix = completionCertificateNumberPrefix(input.year);
  if (input.lastNumber === null)
    return `${prefix}${"1".padStart(SEQUENCE_DIGITS, "0")}`;

  const tail = input.lastNumber.slice(prefix.length);
  const parsed = Number(tail);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(
      `A legutolsó teljesítési igazolás száma nem értelmezhető: ${input.lastNumber}`,
    );
  }
  return `${prefix}${String(parsed + 1).padStart(SEQUENCE_DIGITS, "0")}`;
}
