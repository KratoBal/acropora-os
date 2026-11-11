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

/** A card or online payment at ordering: the shared classifier of the missing-payments list. */
export function isCardPayment(
  paymentMethod: string | null | undefined,
): boolean {
  return outgoingMissingPayments(paymentMethod ?? null) === "CARD_AT_ORDER";
}

/**
 * The window's and the server's rule for the three dates, one function, one Hungarian sentence per refusal:
 * every date a real calendar day; the issue date not later than today; the due date not earlier than the issue
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
