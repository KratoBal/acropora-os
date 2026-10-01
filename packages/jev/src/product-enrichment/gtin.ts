/**
 * GTIN (EAN-8 / UPC-A / EAN-13 / GTIN-14) validation for Tier C.
 *
 * Deliberately STRICTER than `apps/api/src/products/barcode.util.ts`. That
 * one is the barcode column's parser: the shop's own internal codes live there
 * too, so it only reports the check digit. Here the question is "is this the
 * product's EAN", and a code that fails the check digit is not, whoever
 * printed it.
 *
 * The only formatting forgiven is whitespace ("5 901234 123457" is how a
 * printed EAN reads). Anything else (hyphen, letter, a dropped digit) is
 * rejected with a reason: a Tier C value is copied, never repaired.
 */

export type GtinKind = "GTIN-8" | "GTIN-12" | "GTIN-13" | "GTIN-14";

const KIND_BY_LENGTH: Record<number, GtinKind> = {
  8: "GTIN-8",
  12: "GTIN-12",
  13: "GTIN-13",
  14: "GTIN-14",
};

export type GtinResult =
  | {
      ok: true;
      kind: GtinKind;
      /** The digits as written. */
      code: string;
      /**
       * Zero-padded to 14 digits, the GS1 comparison form: a UPC-A written as
       * 12 digits and the same number written as 13 are the same GTIN.
       */
      gtin14: string;
      /**
       * GS1 restricted-circulation range (in-store numbers, prefix 02/04/2x).
       * Valid as a number, but not a manufacturer's EAN; reported, not rejected.
       */
      restrictedCirculation: boolean;
    }
  | { ok: false; reason: string };

/** The GS1 check digit for a body of digits (everything but the last one). */
export function gtinCheckDigit(body: string): number {
  let sum = 0;
  // Weights alternate 3,1,... from the rightmost body digit leftwards.
  for (let i = 0; i < body.length; i++) {
    const digit = body.charCodeAt(body.length - 1 - i) - 48;
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

export function validateGtin(raw: string): GtinResult {
  const code = raw.replace(/[\s\u00a0\u2009\u202f]/g, "");
  if (code === "") return { ok: false, reason: "empty" };
  if (!/^\d+$/.test(code))
    return { ok: false, reason: "a GTIN contains digits only" };
  const kind = KIND_BY_LENGTH[code.length];
  if (!kind)
    return {
      ok: false,
      reason: `length ${code.length} is not a GTIN length (8, 12, 13 or 14)`,
    };
  if (/^0+$/.test(code)) return { ok: false, reason: "all zeros" };

  const check = code.charCodeAt(code.length - 1) - 48;
  const expected = gtinCheckDigit(code.slice(0, -1));
  if (check !== expected)
    return {
      ok: false,
      reason: `check digit ${check} does not match the computed ${expected}`,
    };

  const gtin14 = code.padStart(14, "0");
  const g13 = gtin14.slice(1);
  const restrictedCirculation =
    kind !== "GTIN-8" &&
    (g13.startsWith("2") || g13.startsWith("02") || g13.startsWith("04"));

  return { ok: true, kind, code, gtin14, restrictedCirculation };
}
