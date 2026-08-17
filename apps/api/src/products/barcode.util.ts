export const BARCODE_MIN_LENGTH = 4;
export const BARCODE_MAX_LENGTH = 48;

export type BarcodeParseResult =
  | { valid: true; code: string; eanCheckDigitValid: boolean | null }
  | { valid: false; reason: string };

/**
 * Normalises a scanned or typed barcode.
 *
 * Scanners and spreadsheets both add whitespace, and a copied cell often
 * carries a non-breaking space or a zero-width character that is invisible in
 * every UI but makes the string unequal to the same code typed by hand. Those
 * are stripped, and the rest is required to be plain alphanumerics: the store
 * uses EAN codes plus its own internal ones, and neither contains punctuation.
 *
 * The EAN check digit is *reported*, never enforced. Rejecting a code because
 * its check digit fails would refuse the shop's own internal numbering, which
 * is not EAN and never claimed to be. The caller decides what to do with a
 * failing digit; the import path records it, the UI warns.
 */
export function parseBarcode(raw: string): BarcodeParseResult {
  const code = raw.replace(/[\s ​-‍﻿]/g, "").toUpperCase();

  if (!code) return { valid: false, reason: "A vonalkód nem lehet üres." };
  if (code.length < BARCODE_MIN_LENGTH)
    return {
      valid: false,
      reason: `A vonalkód legalább ${BARCODE_MIN_LENGTH} karakter legyen.`,
    };
  if (code.length > BARCODE_MAX_LENGTH)
    return {
      valid: false,
      reason: `A vonalkód legfeljebb ${BARCODE_MAX_LENGTH} karakter lehet.`,
    };
  if (!/^[0-9A-Z]+$/.test(code))
    return {
      valid: false,
      reason: "A vonalkód csak számot és angol nagybetűt tartalmazhat.",
    };

  return { valid: true, code, eanCheckDigitValid: eanCheckDigitValid(code) };
}

/**
 * Returns null when the code is not an EAN/UPC-shaped number at all (8, 12,
 * 13 or 14 digits) - "not applicable" is deliberately distinct from "wrong".
 */
export function eanCheckDigitValid(code: string): boolean | null {
  if (!/^\d+$/.test(code)) return null;
  if (![8, 12, 13, 14].includes(code.length)) return null;

  const digits = [...code].map(Number);
  const check = digits.pop() as number;
  // Weights alternate 3,1,... from the rightmost body digit leftwards, for
  // every length in the EAN/UPC family.
  const sum = digits
    .reverse()
    .reduce(
      (total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1),
      0,
    );

  return (10 - (sum % 10)) % 10 === check;
}
