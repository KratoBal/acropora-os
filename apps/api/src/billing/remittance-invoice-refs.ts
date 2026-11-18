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
  /**
   * Set for a number written in FULL (`E-CRPR-2026-1`, `D-CRPR-7`: our Számlázz.hu e-invoice and díjbekérő series), upper-case, no
   * year/number split: it matches only that exact invoice number. `year` and `number` are empty then.
   */
  literal?: string;
}

export const RANGE_LIMIT = 20;

/*
  THE CUSTOMER'S OWN REFERENCES ARE NOT OURS (the Banki átutalások survey, 2026-11-18). Two shapes of the same text
  ("HCUT/2026/003814 2026/00058 S/2026/0005034") were read wrongly:
  - a number right behind a letter or digit and a slash (`HCUT/2026/003814`, `S/2026/...`) is the customer's order or its
    own series, like `SZ-2026/00012`: only ours, or none, is a reference to our invoices. A list written with slashes
    (`2026/00083/2026/00084`) loses its second member by this; a missing member never pairs, a foreign one would;
  - the serial is three to six digits and then NO digit: a seven-digit `S/2026/0005034` was cut to `2026/000503`, half a number
    read as a whole one. Numbers are compared as numbers (000503 is 503), so a cut or foreign number could equal one of our
    invoices (`ACRW-2026/00503`) and be offered for pairing.
*/
// "és" has no ASCII word boundary (`\b` is ASCII in JavaScript), so it stands as a plain separator
const SEPARATOR = String.raw`\s*(?:[,;+&-]|és)\s*`;
const REFERENCE = new RegExp(
  String.raw`(?:\b(A(?:CR|RC)[A-Z])(?:\s*\/\s*|[-\s])?|(?<![A-Za-z]-?|[A-Za-z0-9]\/)\b)(20\d{2})\s*\/\s*(\d{3,6})(?!\d)((?:${SEPARATOR}\d{1,6}(?![\d/]|\s*\/))*)`,
  "giu",
);
const CONTINUATION = /\s*([,;+&-]|és)\s*(\d{1,6})/gu;

/*
  OUR OTHER NUMBER SHAPES (the Banki átutalások survey, 2026-11-18; acrobot 55667, memory 2652): the Számlázz.hu series E-CRPR,
  E-CRPRW and CRPR(W) carry the year after a hyphen (`E-CRPR-2026-1`, `CRPRW-2022-5`), and the díjbekérő is `D-CRPR-7`. Live, a
  credit naming `E-CRPR-2026-1` and one naming `D-CRPR-7` stood as "no reference", hidden. Only these known series are read:
  an invented pattern for any `XXX-2026-1` would name numbers that are not ours. EINV numbers are eBIZ's (`remittanceEbizNumbers`).
*/
/*
  SHORTENED NUMBERS AFTER A FULL ONE (Luca, 2026-11-18 14:57 UTC; acrobot 55990): the credit "HC0000007106 E-CRPRW-2026-6,5" names two invoices, the 6 and the 5, and only the first was read. The same
  shapes as the year/number reference (a comma, ; + & or "és" list, a "-" range), but these serials are NOT zero-padded, so a further number is its OWN full serial (`,5` is the 5), it does not replace
  the last digits of the first. What cannot be read without a guess is not read: a number SHORTER than the first (`12,3` is the 3 or the 13) ends the list, like a backward or too long range. A
  following number is not a member when another digit, a "/" or a "-digit" follows it (a date `2026-11-18`, a `2026/00083` reference), or when it is an AMOUNT: a thousands group (a space and three digits, `3 001 010`) or Ft / HUF / forint after it (barracuda, #2699).
*/
const LITERAL = new RegExp(
  String.raw`(?<![A-Za-z0-9])((?:E-CRPRW?|CRPRW?)-(?:19|20)\d{2}-|D-CRPRW?-)(\d{1,6})(?![A-Za-z0-9])((?:${SEPARATOR}\d{1,6}(?![\d/]|-\d|\s*\/|\s\d{3}(?!\d)|\s*(?:ft|huf|forint)))*)`,
  "giu",
);
const EBIZ_NUMBER = /(?<![A-Za-z0-9])(EINV\d{6,10})(?![A-Za-z0-9])/giu;

/** The eBIZ invoice numbers a text names (`EINV000000819`), upper-case, in order, each once: not ours, not paid through Számlázz.hu. */
export function remittanceEbizNumbers(text: string): string[] {
  return [
    ...new Set([...text.matchAll(EBIZ_NUMBER)].map((m) => m[1]!.toUpperCase())),
  ];
}

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
  const addLiteral = (literal: string) => {
    const key = `lit|${literal}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ prefix: null, year: "", number: "", literal });
  };
  for (const match of text.matchAll(LITERAL)) {
    const head = match[1]!.toUpperCase();
    const base = match[2]!;
    addLiteral(`${head}${base}`);
    let previous = Number(base);
    for (const part of (match[3] ?? "").matchAll(CONTINUATION)) {
      const separator = part[1]!;
      const digits = part[2]!;
      // a shorter number than the first is the 3 or the 13: not guessed, the list ends
      if (digits.length < base.length) break;
      const next = Number(digits);
      if (separator === "-") {
        if (next < previous || next - previous + 1 > RANGE_LIMIT) break;
        for (let value = previous + 1; value <= next; value += 1)
          addLiteral(`${head}${value}`);
      } else addLiteral(`${head}${next}`);
      previous = next;
    }
  }
  return out;
}

/** The reference as a person reads it: the full number, or year/number. */
export const refLabel = (ref: RemittanceInvoiceRef): string =>
  ref.literal ?? `${ref.year}/${ref.number}`;

/**
 * Whether an invoice number is the reference; without a prefix, any of our series fits. The number is compared as a
 * number, so a customer's extra zero (`2026/000436`) is still `ACRW-2026/00436`.
 *
 * OUR SERIES WITHOUT A PREFIX (aeddb2c3, Balázs's live run 2026-11-05 11:05): the `2026/` series is numbered
 * `2026/00083`, with no letters at all (`external-invoice-mail-pdf.ts`, "the invoices without a letter"). Every
 * transfer naming one stood as "nincs" while the invoice was there. A reference WITH a prefix still names only that
 * series: `ACRW-2026/00083` is not `2026/00083`.
 */
export function refMatchesInvoiceNumber(
  ref: RemittanceInvoiceRef,
  invoiceNumber: string,
): boolean {
  // a number written in full matches only that exact number, any case
  if (ref.literal !== undefined)
    return invoiceNumber.replace(/\s/g, "").toUpperCase() === ref.literal;
  const match = /^(?:([A-Z]+)-)?(\d{4})\/(\d+)$/i.exec(invoiceNumber.trim());
  if (!match) return false;
  if (match[2] !== ref.year || Number(match[3]) !== Number(ref.number))
    return false;
  if (!ref.prefix) return true;
  if (!match[1]) return false;
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
