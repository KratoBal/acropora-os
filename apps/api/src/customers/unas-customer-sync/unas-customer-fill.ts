import type { UnasApiCustomer } from "@acropora/types";
import { normalizeEuTaxNumber, normalizeHuTaxNumber } from "@acropora/types";

/**
 * WHAT A UNAS CUSTOMER FILLS ON ITS OS ROW, AND ONLY WHERE THE ROW IS EMPTY (Balázs 2026-11-04 19:07 UTC: the zoo has a
 * tax number in UNAS, the OS row had none; acrobot 42670). A colleague's edit of these on the customer page (acrobot
 * 42510) is never overwritten: `fillIfEmpty` writes a field only when the row's value is missing or blank. A new row
 * gets them all at creation.
 *
 * The source is the invoice address, and only a company's: a private person who once typed a number into UNAS does
 * not become a tax-number buyer (the same rule as the backfill from the orders, barracuda #2163). The Hungarian number
 * goes in its stored, dotted shape; a value of another shape is not written into the Hungarian field.
 */
export interface UnasCustomerFill {
  taxNumber: string | null;
  euTaxNumber: string | null;
  companyName: string | null;
}

const FILL_KEYS = ["taxNumber", "euTaxNumber", "companyName"] as const;

export function unasCustomerFill(customer: UnasApiCustomer): UnasCustomerFill {
  const invoice = customer.invoiceAddress;
  if (invoice?.customerType !== "company")
    return { taxNumber: null, euTaxNumber: null, companyName: null };
  const taxNumber = invoice.taxNumber?.trim();
  const euTaxNumber = invoice.euTaxNumber?.trim();
  return {
    taxNumber: taxNumber ? normalizeHuTaxNumber(taxNumber) : null,
    euTaxNumber: euTaxNumber ? normalizeEuTaxNumber(euTaxNumber) : null,
    companyName: invoice.name?.trim() || null,
  };
}

/** The fields to write on the row: the UNAS value where the row has none, nothing else. */
export function fillIfEmpty(
  row: UnasCustomerFill,
  fill: UnasCustomerFill,
): Partial<UnasCustomerFill> {
  const data: Partial<UnasCustomerFill> = {};
  for (const key of FILL_KEYS) {
    const value = fill[key];
    if (value && !row[key]?.trim()) data[key] = value;
  }
  return data;
}

/**
 * A REFERENCE MOVED BY A PARTNER MERGE (murena 42674, 42688: partner register step 4). The merge spreads `mergedFrom`
 * (the id of the customer row that went away) into the reference's metadata, keeping its other keys; an undo removes
 * that one key. While it stands, the merged row's data belongs to the partner register, not to UNAS: the sync writes
 * nothing on the row, its addresses or its tax fields.
 */
export function mergedFrom(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
    return null;
  const value = (metadata as { mergedFrom?: unknown }).mergedFrom;
  return typeof value === "string" && value.trim() ? value : null;
}

/**
 * THE ONE-TIME BACKFILL OF THE EXISTING ROWS, counted per UNAS customer, every customer in exactly one bucket. The
 * tax buckets look at the tax numbers (Hungarian or EU) only; a company name filled alongside is counted separately.
 */
export type UnasTaxBackfillBucket =
  | "filled"
  | "alreadyHad"
  | "missingInUnas"
  | "notHungarianShape"
  | "person"
  | "noOsRow"
  | "merged";

export function unasTaxBackfillBucket(
  customer: UnasApiCustomer,
  fill: UnasCustomerFill,
  written: Partial<UnasCustomerFill>,
): UnasTaxBackfillBucket {
  if (customer.invoiceAddress?.customerType !== "company") return "person";
  if (written.taxNumber || written.euTaxNumber) return "filled";
  if (fill.taxNumber || fill.euTaxNumber) return "alreadyHad";
  return customer.invoiceAddress.taxNumber?.trim() ||
    customer.invoiceAddress.euTaxNumber?.trim()
    ? "notHungarianShape"
    : "missingInUnas";
}

export type UnasTaxBackfillCounts = Record<UnasTaxBackfillBucket, number> & {
  customers: number;
  companyNameFilled: number;
};

export function emptyBackfillCounts(): UnasTaxBackfillCounts {
  return {
    customers: 0,
    filled: 0,
    alreadyHad: 0,
    missingInUnas: 0,
    notHungarianShape: 0,
    person: 0,
    noOsRow: 0,
    merged: 0,
    companyNameFilled: 0,
  };
}

/** The one log line the fleet searches for: counts only, no names and no tax numbers. */
export function unasTaxBackfillLine(
  result:
    | { ok: true; counts: UnasTaxBackfillCounts }
    | { ok: true; alreadyRan: true }
    | { ok: false; reason: string },
): string {
  const head = "UNAS-VEVO-ADOSZAM-VISSZATOLTES";
  if (!result.ok) return `${head} HIBA ok=${result.reason}`;
  if ("alreadyRan" in result) return `${head} mar_lefutott`;
  const c = result.counts;
  return [
    head,
    `unas_vevo=${c.customers}`,
    `kitoltve=${c.filled}`,
    `mar_volt=${c.alreadyHad}`,
    `unasban_sincs=${c.missingInUnas}`,
    `nem_magyar_alak=${c.notHungarianShape}`,
    `maganszemely=${c.person}`,
    `nincs_os_sor=${c.noOsRow}`,
    `osszevont=${c.merged}`,
    `cegnev_kitoltve=${c.companyNameFilled}`,
  ].join(" ");
}
