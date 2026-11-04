/**
 * OUR OWN INVOICE NUMBERS IN AN INCOMING TRANSFER'S REMITTANCE TEXT (card aeddb2c3; Balázs 2026-11-04 16:36 UTC: one
 * transfer for four invoices, közlemény "2026/00083,86,85,84"). Pure functions: what the text names, and whether the
 * transfer's amount is exactly the named invoices' open amounts. Nothing here writes.
 *
 * A reference is a year and a running number (`2026/00083`), with or without our series prefix (ACRW, ACRB, and the
 * mistyped ARCW seen on a real refund: `bank-transaction.classify.ts`). After one, a customer often shortens the rest:
 * - `,86` (or `;`, `+`, `&`, ` és `) repeats the number with its LAST digits replaced: 00083,86 -> 00083, 00086;
 * - `-86` is a range: 00083-86 -> 00083, 00084, 00085, 00086 (at most RANGE_LIMIT numbers, else not read);
 * - a full number after a comma (`,00086`) is the same year's.
 * A shortened part longer than the base number, or a range running backwards, is not read: guessing a number
 * would pair a transfer with someone else's invoice. Nor is a number behind ANOTHER prefix (`SZ-2026/00012`, a
 * quote's or a proforma's): only ours, or none, is a reference to our invoices.
 */
export interface RemittanceInvoiceRef {
  /** the series prefix as written (upper case, ARCW kept), or null when the text gives only year/number */
  prefix: string | null;
  year: string;
  number: string;
}

export const RANGE_LIMIT = 20;

// "és" has no ASCII word boundary (`\b` is ASCII in JavaScript), so it stands as a plain separator
const SEPARATOR = String.raw`\s*(?:[,;+&-]|és)\s*`;
const REFERENCE = new RegExp(
  String.raw`(?:\b(A(?:CR|RC)[A-Z])[-\s]?|(?<![A-Za-z]-?)\b)(20\d{2})\s*\/\s*(\d{3,6})((?:${SEPARATOR}\d{1,6}(?![\d/]|\s*\/))*)`,
  "giu",
);
const CONTINUATION = /\s*([,;+&-]|és)\s*(\d{1,6})/gu;

export function remittanceInvoiceRefs(text: string): RemittanceInvoiceRef[] {
  const out: RemittanceInvoiceRef[] = [];
  const seen = new Set<string>();
  const add = (prefix: string | null, year: string, number: string) => {
    const key = `${prefix ?? ""}|${year}/${number}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ prefix, year, number });
  };
  for (const match of text.matchAll(REFERENCE)) {
    const prefix = match[1]?.toUpperCase() ?? null;
    const year = match[2]!;
    const base = match[3]!;
    add(prefix, year, base);
    let previous = base;
    for (const part of (match[4] ?? "").matchAll(CONTINUATION)) {
      const separator = part[1]!;
      const digits = part[2]!;
      if (digits.length > base.length) break;
      const next = base.slice(0, base.length - digits.length) + digits;
      if (separator === "-") {
        const from = Number(previous);
        const to = Number(next);
        if (to < from || to - from + 1 > RANGE_LIMIT) break;
        for (let value = from + 1; value <= to; value += 1)
          add(prefix, year, String(value).padStart(base.length, "0"));
      } else add(prefix, year, next);
      previous = next;
    }
  }
  return out;
}

/** Whether an invoice number (`ACRW-2026/00083`) is the reference; without a prefix, any of our series fits. */
export function refMatchesInvoiceNumber(
  ref: RemittanceInvoiceRef,
  invoiceNumber: string,
): boolean {
  const match = /^([A-Z]+)-(\d{4})\/(\d+)$/i.exec(invoiceNumber.trim());
  if (!match) return false;
  if (match[2] !== ref.year || Number(match[3]) !== Number(ref.number))
    return false;
  if (!ref.prefix) return true;
  // the mistyped ARCW is ACRW
  const normal = (value: string) => value.toUpperCase().replace(/^ARC/, "ACR");
  return normal(match[1]!) === normal(ref.prefix);
}

/** Money as whole fillér; null when it is not a plain amount or has a non-zero third decimal. */
export function moneyCents(value: string): bigint | null {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return null;
  const fraction = (match[3] ?? "").padEnd(2, "0");
  if (/[^0]/.test(fraction.slice(2))) return null;
  const cents = BigInt(match[2]!) * 100n + BigInt(fraction.slice(0, 2));
  return match[1] ? -cents : cents;
}

export interface OpenInvoice {
  invoiceNumber: string;
  /** what is still open on it, as a decimal string */
  open: string;
}

export type RemittanceMatch =
  | { kind: "NO_REFERENCE" }
  /** a reference with no invoice, or with more than one (two series, the same number) */
  | {
      kind: "UNRESOLVED";
      missing: RemittanceInvoiceRef[];
      ambiguous: RemittanceInvoiceRef[];
    }
  | { kind: "EXACT"; invoices: OpenInvoice[] }
  /** every reference has its one invoice, but the sum is not the amount: difference = amount - sum, in fillér */
  | {
      kind: "AMOUNT_MISMATCH";
      invoices: OpenInvoice[];
      differenceCents: bigint;
    };

/**
 * The transfer against the invoices its text names. Only EXACT is a pairing to offer: every reference has exactly one
 * of our invoices, and the transfer is their open amounts' sum to the fillér. Anything else goes to a person.
 */
export function matchRemittance(
  text: string,
  amount: string,
  invoices: readonly OpenInvoice[],
): RemittanceMatch {
  const refs = remittanceInvoiceRefs(text);
  if (refs.length === 0) return { kind: "NO_REFERENCE" };
  const missing: RemittanceInvoiceRef[] = [];
  const ambiguous: RemittanceInvoiceRef[] = [];
  const found: OpenInvoice[] = [];
  for (const ref of refs) {
    const hits = invoices.filter((invoice) =>
      refMatchesInvoiceNumber(ref, invoice.invoiceNumber),
    );
    if (hits.length === 0) missing.push(ref);
    else if (hits.length > 1) ambiguous.push(ref);
    else if (!found.includes(hits[0]!)) found.push(hits[0]!);
  }
  if (missing.length > 0 || ambiguous.length > 0)
    return { kind: "UNRESOLVED", missing, ambiguous };
  const total = moneyCents(amount);
  const sum = found.reduce<bigint | null>((acc, invoice) => {
    const open = moneyCents(invoice.open);
    return acc === null || open === null ? null : acc + open;
  }, 0n);
  if (total === null || sum === null)
    return { kind: "UNRESOLVED", missing: [], ambiguous: [] };
  return total === sum
    ? { kind: "EXACT", invoices: found }
    : {
        kind: "AMOUNT_MISMATCH",
        invoices: found,
        differenceCents: total - sum,
      };
}
