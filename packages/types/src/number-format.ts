/**
 * ONE MONEY AND NUMBER FORMAT FOR EVERY SCREEN (T1.5, card 4c24a8ab, 2026-11-03).
 *
 * The product page's UNAS mirror showed "6141.7323" and a bare "HUF" while the rest of the page
 * wrote forint amounts (#2079), and the web kept 25 local formatHuf/formatMoney/formatAmount
 * copies that disagree on decimals. This is the one place the rule lives; the guard
 * `apps/web/src/components/pilot/no-raw-number-output.test.ts` keeps new pages on it.
 *
 * The rule is the one the shared billing formatters already wrote (`finance-format.ts`,
 * `billing-editor-state.ts`): hu-HU digits (a no-break space groups from five digits, the
 * comma is the decimal mark: owner decision 2026-10-02, `lib/format/number.ts`); the forint
 * is whole and reads "Ft"; another currency gets two decimals and its code ("100,50 EUR").
 *
 * A missing value (null, undefined, empty) reads "—". A value that is not a number stays as it
 * came: a visible data error, never a silent zero.
 *
 * The mobile app cannot import this package (docs/MOBILE-DEVELOPMENT.md) and keeps its own
 * `formatMoney` in `apps/mobile/src/lib/orders/presentation.ts`.
 */

export const MISSING_VALUE_TEXT = "—";

type NumericInput = number | string | null | undefined;

/** null: missing; NaN: present but not a number. */
function numeric(value: NumericInput): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  const trimmed = value.trim();
  return trimmed === "" ? null : Number(trimmed);
}

function hu(value: number, minimum: number, maximum: number): string {
  return new Intl.NumberFormat("hu-HU", {
    minimumFractionDigits: minimum,
    maximumFractionDigits: maximum,
  }).format(value);
}

/** "HUF" in any case or spacing -> "Ft"; another currency -> its code; missing -> "". */
export function currencyLabel(code: string | null | undefined): string {
  const normalized = (code ?? "").trim().toUpperCase();
  return normalized === "HUF" ? "Ft" : normalized;
}

export interface FormatMoneyOptions {
  /**
   * The decimals a forint amount with fillér shows (a whole amount shows none). Default 0: a total, a
   * gross or a payable amount is whole forint. A net unit price (purchase, UNAS net, price
   * list) and a net or VAT component of a total pass 2: there the fillér is real data, and
   * the #2079 product page was approved as "6141,73 Ft" (acrobot's decision, msg 41593).
   */
  fractionDigits?: number;
}

/**
 * "12 700 Ft", "100,50 EUR". Without a currency the amount stands alone with at most two
 * decimals: the page that has no currency must not invent one.
 */
export function formatMoney(
  amount: NumericInput,
  currency: string | null | undefined,
  options: FormatMoneyOptions = {},
): string {
  const value = numeric(amount);
  if (value === null) return MISSING_VALUE_TEXT;
  if (!Number.isFinite(value)) return String(amount).trim();
  const label = currencyLabel(currency);
  if (label === "") return hu(value, 0, 2);
  if (label !== "Ft") return `${hu(value, 2, 2)} ${label}`;
  const digits = options.fractionDigits ?? 0;
  // With fillér, all the decimals asked for ("787,40 Ft"); a whole amount stays whole.
  const shown = digits > 0 && Number.isInteger(value) ? 0 : digits;
  return `${hu(value, shown, digits)} Ft`;
}

/** A plain number: "12 500", "0,125". At most `maximumFractionDigits` decimals, no trailing zeros. */
export function formatNumber(
  value: NumericInput,
  maximumFractionDigits = 3,
): string {
  const number = numeric(value);
  if (number === null) return MISSING_VALUE_TEXT;
  if (!Number.isFinite(number)) return String(value).trim();
  return hu(number, 0, maximumFractionDigits);
}

/**
 * A stored quantity (decimal string from the API): every stored decimal is kept, up to six,
 * so rounding never hides a quantity the database holds.
 */
export function formatQuantity(value: NumericInput): string {
  return formatNumber(value, 6);
}

/** Percentage points, not a ratio: 27 -> "27%", 12.5 -> "12,5%". */
export function formatPercent(
  value: NumericInput,
  maximumFractionDigits = 1,
): string {
  const text = formatNumber(value, maximumFractionDigits);
  const number = numeric(value);
  return number !== null && Number.isFinite(number) ? `${text}%` : text;
}
