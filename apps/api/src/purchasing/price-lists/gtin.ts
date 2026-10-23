/**
 * A barcode as the price lists write it -> GTIN-14, or null.
 *
 * The lists mix shapes: UPC-A (12 digits), EAN-13 (also with a leading zero
 * that only pads a UPC-A), EAN-8, and odd lengths that are damaged codes
 * (Coralsands has 11- and 4-digit GTIN cells). Only the four GS1 lengths are
 * accepted, left-padded with zeros to 14, so the same code written as UPC-A or
 * as EAN-13 compares equal.
 *
 * THE CHECK DIGIT IS NOT JUDGED HERE. A supplier's list can carry a code whose
 * check digit is wrong, and so can our own barcode table: dropping those codes
 * would drop matches that are exact equalities. Whether the code is a valid GTIN is the barcode
 * table's business (`ProductBarcode.type`, the JEV `validateGtin`), and the
 * pairing step reads it from there.
 */
const VALID_LENGTHS = new Set([8, 12, 13, 14]);

export function normalizeGtin(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.trim();
  if (!/^\d+$/.test(digits) || !VALID_LENGTHS.has(digits.length)) return null;
  return digits.padStart(14, "0");
}
