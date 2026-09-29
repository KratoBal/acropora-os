/**
 * WHAT A GLS "COD REFERENCE" POINTS TO.
 *
 * The shop writes the COD reference when the parcel label is made, and it is
 * not always the same kind of thing. Measured 2026-09-29 with this function
 * on the whole archive: the 709 lines of the 219 COD reports (2022-2026),
 * and the 511 COD parcels of the 81 invoice attachments (2023-2026, mostly
 * the same parcels again):
 *
 *                                                         reports  invoices
 *   ACRW-2026/00469 (one or more invoice numbers,
 *     also the ACRB series)                                  637       470
 *   47679-198934 (a webshop order key)                        39        25
 *   2026/00123 (an invoice number without its prefix)         26        12
 *   CRPRW-2022-5 and the like (2022 only)                      3         0
 *   (empty)                                                    4         4
 *
 * A number without its prefix is NOT completed here: ACRW and ACRB both
 * exist, and a guessed prefix is a wrong invoice with a right-looking number.
 * It becomes a suggestion for the person who checks it.
 */

export type GlsCodReferenceKind =
  | { kind: "INVOICES"; invoiceNumbers: string[] }
  | { kind: "ORDER_KEY"; orderKey: string }
  | { kind: "BARE_INVOICE"; suggestion: string }
  | { kind: "EMPTY" }
  | { kind: "UNKNOWN" };

const INVOICE_NUMBER = /^[A-Z]{3,6}-\d{4}\/\d{5}$/;
const ORDER_KEY = /^\d{5}-\d{6}$/;
const BARE_INVOICE = /^\d{4}\/\d{5}$/;

export function classifyCodReference(
  raw: string | null | undefined,
): GlsCodReferenceKind {
  const value = raw?.trim() ?? "";
  if (value === "") return { kind: "EMPTY" };
  if (ORDER_KEY.test(value)) return { kind: "ORDER_KEY", orderKey: value };
  if (BARE_INVOICE.test(value))
    return { kind: "BARE_INVOICE", suggestion: `ACRW-${value}` };
  const tokens = value.split(/[\s,;]+/).filter(Boolean);
  if (tokens.length > 0 && tokens.every((token) => INVOICE_NUMBER.test(token)))
    return { kind: "INVOICES", invoiceNumbers: [...new Set(tokens)] };
  return { kind: "UNKNOWN" };
}

/** The client reference, when it is a webshop order key. */
export function orderKeyOf(raw: string | null | undefined): string | null {
  const value = raw?.trim() ?? "";
  return ORDER_KEY.test(value) ? value : null;
}
