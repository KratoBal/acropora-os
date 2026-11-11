import { outgoingMissingPayments } from "./billing-payment-state.js";

/**
 * THE INVOICE CONFIRMATION BEFORE EVERY ISSUE (card 7ba97e0d; Balázs 2026-11-11 11:12-11:14 UTC).
 *
 * Wherever an invoice is issued, a small window first shows its basic data: the buyer's name, address and tax
 * number, the issue date, the fulfilment date, the payment due date, the payment method, and where it will be sent.
 * The invoice is made on "Kiállítom". THE THREE DATES ARE EDITABLE there and the invoice is made with the edited
 * values; everything else is shown only. The values come from the SAME server code that builds the real issue, and
 * the issue re-checks them: what the window showed is what the invoice carries.
 *
 * A CARD PAYMENT (Stripe, any card or online payment, by the shared classifier) is due on the issue date: the due
 * date follows the issue date and cannot be set apart (Balázs 11:14: "a határidő a keltével egyezzen").
 */
export interface BillingIssueSummary {
  buyerName: string;
  /** One line: postal code, city, street. */
  buyerAddress: string;
  buyerTaxNumber: string | null;
  /** Only for an EU buyer without a Hungarian tax number (the invoice carries it in its own field). */
  buyerEuTaxNumber: string | null;
  /**
   * Where the invoice goes when it is sent from the window (Balázs 11:13: "a küldés tényleg erre a címre menjen"): the
   * buyer's billing e-mail, or the e-mail when there is none, as the issue's own builder takes it. Null: no address.
   */
  buyerEmail: string | null;
  /** The proposed issue date: today in Budapest. */
  issueDate: string;
  fulfillmentDate: string;
  /** Null for a document type with no payment fields (a delivery note). */
  dueDate: string | null;
  paymentMethod: string | null;
  showsPaymentFields: boolean;
  /** A card payment: the due date is the issue date and cannot be set apart. */
  dueDateFollowsIssueDate: boolean;
  /**
   * A digest of the shown, NOT editable values. The issue sends it back, the server recomputes it, and a
   * difference (someone changed the buyer meanwhile) stops the issue instead of issuing what was not shown.
   */
  fingerprint: string;
}

/** What the window sends back with "Kiállítom". */
export interface BillingIssueConfirmation {
  issueDate: string;
  fulfillmentDate: string;
  dueDate: string | null;
  fingerprint: string;
}

/**
 * The webshop invoice's confirmation (card 7ba97e0d, S2): the same, plus "Elküldöm e-mailben" (Balázs 11:20). The
 * address is the summary's `buyerEmail`, part of the fingerprint, so the invoice goes where the window said.
 */
export interface WebshopInvoiceConfirmation extends BillingIssueConfirmation {
  send: boolean;
}

/**
 * What a webshop invoice issue answers (card 7ba97e0d, S2): the fresh order, and what happened to the sending. The
 * invoice is made before the letter, so a failed send never reads as a failed issue (barracuda on #2419).
 * `mail` null: no sending was asked.
 */
export interface WebshopInvoiceIssueResult<Order> {
  order: Order;
  mail:
    | { to: string; sent: true }
    | { to: string; sent: false; error: string }
    | null;
}

/** The webshop invoice's summary: the billing summary of the order's saved draft, and that draft's id. */
export interface WebshopInvoiceSummary extends BillingIssueSummary {
  documentId: string;
}

export type BillingIssueDatesCheck =
  | {
      ok: true;
      value: {
        issueDate: string;
        fulfillmentDate: string;
        dueDate: string | null;
      };
    }
  | { ok: false; error: string };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (value: unknown): value is string =>
  typeof value === "string" &&
  DAY.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

/** `yyyy-MM-dd` moved by whole days or years, on the calendar (no time zone shift). */
function shiftDay(day: string, by: { days?: number; years?: number }): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  if (by.years) date.setUTCFullYear(date.getUTCFullYear() + by.years);
  if (by.days) date.setUTCDate(date.getUTCDate() + by.days);
  return date.toISOString().slice(0, 10);
}

/**
 * THE DUE DATE THE WINDOW PROPOSES (acrobot 47091, after S1): the draft's, unless it falls before the issue date (a
 * draft saved days ago and issued today). Then it is the issue date plus the buyer's payment days, as a new invoice
 * would count it. Null stays null: the issue refuses a missing due date with its own message.
 */
export function proposedIssueDueDate(
  draftDueDate: string | null,
  issueDate: string,
  paymentDueDays: number,
): string | null {
  if (draftDueDate === null || draftDueDate >= issueDate) return draftDueDate;
  return shiftDay(issueDate, { days: paymentDueDays });
}

/** A card or online payment at ordering: the shared classifier of the missing-payments list. */
export function isCardPayment(
  paymentMethod: string | null | undefined,
): boolean {
  return outgoingMissingPayments(paymentMethod ?? null) === "CARD_AT_ORDER";
}

/**
 * The window's and the server's rule for the three dates, one function, one Hungarian sentence per refusal:
 * every date a real calendar day; the issue date not later than today; the fulfilment date at most a year before or
 * after the issue date; the due date not earlier than the issue
 * date; for a card payment the due date IS the issue date (whatever was sent). Without payment fields no due date.
 */
export function checkBillingIssueDates(
  input: { issueDate?: unknown; fulfillmentDate?: unknown; dueDate?: unknown },
  context: {
    today: string;
    showsPaymentFields: boolean;
    dueDateFollowsIssueDate: boolean;
  },
): BillingIssueDatesCheck {
  if (!isDay(input.issueDate))
    return { ok: false, error: "A számla kelte egy naptári nap lehet." };
  if (input.issueDate > context.today)
    return {
      ok: false,
      error: "A számla kelte nem lehet későbbi a mai napnál.",
    };
  if (!isDay(input.fulfillmentDate))
    return { ok: false, error: "A teljesítés ideje egy naptári nap lehet." };
  // a sanity bound (acrobot 47091): a mistyped year ("2062") does not reach the invoice
  if (
    input.fulfillmentDate < shiftDay(input.issueDate, { years: -1 }) ||
    input.fulfillmentDate > shiftDay(input.issueDate, { years: 1 })
  )
    return {
      ok: false,
      error:
        "A teljesítés ideje legfeljebb egy évvel térhet el a számla keltétől.",
    };
  if (!context.showsPaymentFields)
    return {
      ok: true,
      value: {
        issueDate: input.issueDate,
        fulfillmentDate: input.fulfillmentDate,
        dueDate: null,
      },
    };
  if (context.dueDateFollowsIssueDate)
    return {
      ok: true,
      value: {
        issueDate: input.issueDate,
        fulfillmentDate: input.fulfillmentDate,
        dueDate: input.issueDate,
      },
    };
  if (!isDay(input.dueDate))
    return { ok: false, error: "A fizetési határidő egy naptári nap lehet." };
  if (input.dueDate < input.issueDate)
    return {
      ok: false,
      error: "A fizetési határidő nem lehet korábbi a számla kelténél.",
    };
  return {
    ok: true,
    value: {
      issueDate: input.issueDate,
      fulfillmentDate: input.fulfillmentDate,
      dueDate: input.dueDate,
    },
  };
}
