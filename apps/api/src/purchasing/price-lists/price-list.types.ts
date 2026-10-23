/**
 * SUPPLIER PRICE LISTS: what a parser hands over (task beszallitoi-arlistak,
 * card 78f2b6d6, slice 1).
 *
 * A parser is a pure function of the file's bytes: no database, no network, no
 * clock. It never guesses. A row it cannot read with certainty goes to
 * `rejected` with a reason, so the upload summary can say how many rows were
 * left out and why; nothing is dropped silently.
 *
 * Prices are DECIMAL STRINGS ("30.65"), never JavaScript numbers: the column is
 * `Decimal(19,4)` and a float would turn 4.10 into 4.0999999999999996.
 */

export const PRICE_LIST_FORMATS = [
  "DEJONG_STOCKLIST",
  "HERTLEIN_ARTIKEL",
  "CORALSANDS_PREISLISTE",
] as const;

export type PriceListFormat = (typeof PRICE_LIST_FORMATS)[number];

export interface ParsedPriceEntry {
  /** 1-based record number in the file (a quoted newline does not start a new record). */
  rowNumber: number;
  supplierSku: string;
  supplierName: string | null;
  brand: string | null;
  /** Normalized GTIN-14 with a valid check digit, or null. */
  gtin: string | null;
  /** The purchase unit price in the list's currency, as a plain decimal string. */
  unitPrice: string;
  /** The recommended retail price (UVP), display only; null when absent or unreadable. */
  listRetailPrice: string | null;
}

export type RejectReason =
  /** The row has no supplier code. */
  | "NO_CODE"
  /** The row names a product but carries no price. */
  | "NO_PRICE"
  /** The price is not a plain decimal in the format's notation, or has more than 4 decimals. */
  | "BAD_PRICE"
  /** Two price fields that do not fit together by the format's rule (Hertlein tiers). */
  | "TIER_PRICE_UNREADABLE"
  /**
   * The code appeared earlier in the same file with a DIFFERENT price; the first
   * row is kept. (An identical repeat is not a conflict: see `duplicateRows`.)
   */
  | "CONFLICTING_DUPLICATE";

export interface RejectedRow {
  rowNumber: number;
  reason: RejectReason;
}

export interface ParsedPriceList {
  format: PriceListFormat;
  entries: ParsedPriceEntry[];
  rejected: RejectedRow[];
  /** Rows that are not data on purpose: blank lines, section titles, a repeated header. */
  skippedRows: number;
  /**
   * Rows that repeat an earlier row of the same code with the SAME price. The
   * Hertlein file of 2026-10-23 holds 166 such pairs, all with identical prices;
   * they are counted so the summary can say so, and kept out of `rejected`
   * because there is nothing for a person to decide.
   */
  duplicateRows: number;
}

/** Why a WHOLE file is refused (as opposed to single rows). */
export type PriceListParseErrorCode =
  | "FILE_TOO_LARGE"
  | "UNREADABLE_ENCODING"
  /** The format's header row (the column names) is not in the file. */
  | "HEADER_NOT_FOUND"
  | "NO_VALID_ROWS"
  /** More rows were rejected than a file of this format can plausibly hold: wrong format chosen, or a damaged file. */
  | "TOO_MANY_REJECTED_ROWS";

export class PriceListParseError extends Error {
  constructor(readonly code: PriceListParseErrorCode) {
    super(code);
    this.name = "PriceListParseError";
  }
}
