/**
 * Stripe settlement (A9, card 6339b04c): Stripe's payouts, each transaction in them tied to the webshop order and its outgoing
 * invoice. Balázs, 2026-11-18 20:16 UTC: card payments move to Stripe and the OS has no Stripe settlement ("Simplepay van de azt
 * kivezetjük"). The SimplePay settlement's shape; the data comes from the webshop backend's read-only feed (commerce #803), so the
 * OS holds no Stripe key.
 */

export type StripePayoutStatus = "COMPLETED" | "NEEDS_REVIEW";
export type StripeLineStatus = "RESOLVED" | "NEEDS_REVIEW" | "NOT_APPLICABLE";
export type StripeResolutionSource = "PAYMENT_INTENT" | "MANUAL";

/**
 * Why a PAYOUT needs a look, apart from its lines:
 *   TOTAL_MISMATCH   the lines' net is not the amount Stripe paid out (a transaction is missing, or Stripe's totals moved)
 *   MANUAL_PAYOUT    Stripe lists a payout's transactions for AUTOMATIC payouts only
 *   LINES_NOT_READ   the reading stopped at the page limit before the end
 */
export type StripePayoutError =
  "TOTAL_MISMATCH" | "MANUAL_PAYOUT" | "LINES_NOT_READ";

/**
 * Why a line needs a look:
 *   INTENT_UNKNOWN       a payment or refund line with no PaymentIntent (the feed could not name it)
 *   ORDER_NOT_FOUND      no webshop order carries the intent (a payment taken outside the shop, or an order older than
 *                        the backend's look-back)
 *   ORDERS_NOT_READ      the backend stopped reading orders before the end (`orders_truncated`): not a "no order"
 *   AMOUNT_MISMATCH      the order(s) are found, but their total is not the amount Stripe took (a mixed cart's two orders
 *                        are summed)
 *   ORDER_NOT_INVOICED   the order(s) are found and the amount fits, but there is no live outgoing invoice
 *   REFUND_UNCHECKED     a refund: its order is found, but whether the invoice was cancelled or corrected is not checked
 *                        yet, so a person decides
 *   TYPE_UNKNOWN         a line that is neither a payment, a refund nor a Stripe fee (a dispute, an adjustment, a reserve):
 *                        never hidden as "not applicable", a person looks at it
 */
export type StripeLineError =
  | "INTENT_UNKNOWN"
  | "ORDER_NOT_FOUND"
  | "ORDERS_NOT_READ"
  | "AMOUNT_MISMATCH"
  | "ORDER_NOT_INVOICED"
  | "REFUND_UNCHECKED"
  | "TYPE_UNKNOWN";

export interface StripeTransactionLine {
  id: string;
  stripeTransactionId: string;
  /** charge, payment, refund, payment_refund, stripe_fee, adjustment... as Stripe names it. */
  type: string;
  reportingCategory?: string;
  /** ISO time of the balance transaction. */
  stripeCreatedAt: string;
  currency: string;
  /** Major unit (forint), signed: a refund is negative. */
  amount: string;
  fee: string;
  net: string;
  paymentIntentId?: string;
  chargeId?: string;
  refundId?: string;
  /** The order numbers the intent paid (two for a mixed cart). */
  orderNumbers: string[];
  /** The orders' summed total, when the orders are found: the difference shows from this. */
  orderTotal?: string;
  invoiceNumbers: string[];
  status: StripeLineStatus;
  resolutionSource?: StripeResolutionSource;
  errorCode?: StripeLineError;
  manualApprovedAt?: string;
  manualApprovedByDisplayName?: string;
  updatedAt: string;
}

export interface StripePayoutSummary {
  id: string;
  stripePayoutId: string;
  /** The day the money reaches the bank. */
  arrivalDate: string;
  currency: string;
  /** What Stripe paid out. */
  amount: string;
  grossTotal: string;
  refundTotal: string;
  feeTotal: string;
  netTotal: string;
  lineCount: number;
  resolvedLineCount: number;
  unresolvedLineCount: number;
  status: StripePayoutStatus;
  errorCode?: StripePayoutError;
  /** The backend stopped reading orders early; some "no order" lines may be that. */
  ordersTruncated: boolean;
  createdAt: string;
}

export interface StripePayoutDetail extends StripePayoutSummary {
  lines: StripeTransactionLine[];
}

export interface StripePayoutListResponse {
  items: StripePayoutSummary[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

export interface StripeManualApprovalInput {
  /** The outgoing invoice this payment paid. */
  invoiceNumber: string;
  expectedUpdatedAt: string;
}

export type StripeSyncState =
  "ENABLED" | "DISABLED_NOT_SET" | "DISABLED_OFF" | "DISABLED_UNRECOGNISED";

export interface StripeSyncRunSummary {
  status: "RUNNING" | "APPLIED" | "FAILED";
  trigger: "SCHEDULED" | "MANUAL";
  startedAt: string;
  completedAt?: string;
  payoutsSeen: number;
  payoutsNew: number;
  payoutsReresolved: number;
  failedCount: number;
  errorCode?: string;
}

export interface StripeSyncStatus {
  state: StripeSyncState;
  intervalMinutes: number;
  lastRun?: StripeSyncRunSummary;
  /** The latest timer-started run: whether it really runs by itself. */
  lastScheduledRun?: StripeSyncRunSummary;
}
