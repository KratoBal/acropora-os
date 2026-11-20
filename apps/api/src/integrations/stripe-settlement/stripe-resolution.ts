import type { StripeLineError } from "@acropora/types";

import type { SimplePayOrderDocument } from "../simplepay/simplepay-resolution.js";

/**
 * WHICH ORDER AND INVOICE A STRIPE TRANSACTION PAID (A9, card 6339b04c). The webshop backend names the orders each PaymentIntent
 * paid (commerce #804); the OS only decides what that means. Local data and the feed only, no Stripe call.
 *
 * Per line:
 *   - a Stripe fee line (`stripe_fee`, `stripe_fx_fee`, `tax_fee`): NOT_APPLICABLE, it counts in the payout's totals only;
 *   - a payment (`charge`, `payment`):
 *       no intent -> INTENT_UNKNOWN; no order -> ORDER_NOT_FOUND (or ORDERS_NOT_READ when the backend stopped reading orders);
 *       the order totals (summed: a mixed cart is two orders, one payment) must be the amount Stripe took, else AMOUNT_MISMATCH;
 *       every order needs a live outgoing invoice, else ORDER_NOT_INVOICED; otherwise RESOLVED with the invoice numbers;
 *   - a refund (`refund`, `payment_refund`): never decided as a single line. Its PaymentIntent has payment lines and refund lines, maybe
 *     in different payouts, and the orders are decided by all of them together, with the SimplePay refund rule (c03e9896,
 *     `resolveStripeRefundIntent`: net = payments minus refunds against the orders' invoices, storno and credit notes). Only where
 *     that cannot run (the webshop stopped reading orders) a refund line stays for a person (REFUND_UNCHECKED);
 *   - any other type (a dispute, an adjustment, a reserve): TYPE_UNKNOWN. Not hidden as "not applicable": a chargeback must not
 *     look settled.
 */
export const STRIPE_FEE_TYPES: readonly string[] = [
  "stripe_fee",
  "stripe_fx_fee",
  "tax_fee",
];
export const STRIPE_PAYMENT_TYPES: readonly string[] = ["charge", "payment"];
export const STRIPE_REFUND_TYPES: readonly string[] = [
  "refund",
  "payment_refund",
];

export interface StripeLineOrder {
  id: string;
  displayId: number | null;
  /** Major unit (forint). */
  total: number;
}

export interface StripeLineInput {
  type: string;
  /** Major unit, signed. */
  amount: number;
  paymentIntent: string | null;
  orders: readonly StripeLineOrder[];
  /** The backend stopped reading orders before the end. */
  ordersTruncated: boolean;
}

/** orderId -> its LIVE outgoing invoice numbers (an issued invoice no storno points at). */
export type StripeOrderInvoices = ReadonlyMap<string, readonly string[]>;

export type StripeLineResolution =
  | {
      status: "RESOLVED";
      orderIds: string[];
      orderNumbers: string[];
      orderTotal: number;
      invoiceNumbers: string[];
    }
  | { status: "NOT_APPLICABLE" }
  | {
      status: "NEEDS_REVIEW";
      errorCode: StripeLineError;
      orderIds: string[];
      orderNumbers: string[];
      orderTotal: number | null;
      invoiceNumbers: string[];
    };

/** Money to the cent, so a Decimal and a feed number compare. */
const cents = (value: number) => Math.round(value * 100);

export function resolveStripeLine(
  line: StripeLineInput,
  invoices: StripeOrderInvoices,
): StripeLineResolution {
  if (STRIPE_FEE_TYPES.includes(line.type)) return { status: "NOT_APPLICABLE" };

  const orderIds = line.orders.map((order) => order.id);
  const orderNumbers = line.orders.map((order) =>
    order.displayId === null ? order.id : String(order.displayId),
  );
  const orderTotal = line.orders.length
    ? line.orders.reduce((sum, order) => sum + cents(order.total), 0) / 100
    : null;
  const invoiceNumbers = [
    ...new Set(line.orders.flatMap((order) => invoices.get(order.id) ?? [])),
  ];
  const review = (errorCode: StripeLineError): StripeLineResolution => ({
    status: "NEEDS_REVIEW",
    errorCode,
    orderIds,
    orderNumbers,
    orderTotal,
    invoiceNumbers,
  });

  const isPayment = STRIPE_PAYMENT_TYPES.includes(line.type);
  const isRefund = STRIPE_REFUND_TYPES.includes(line.type);
  if (!isPayment && !isRefund) return review("TYPE_UNKNOWN");

  if (!line.paymentIntent) return review("INTENT_UNKNOWN");
  if (line.orders.length === 0)
    return review(line.ordersTruncated ? "ORDERS_NOT_READ" : "ORDER_NOT_FOUND");
  // a refund line alone is not decided here: `resolveStripeRefundIntent` decides a refunded PaymentIntent, as a whole
  if (isRefund) return review("REFUND_UNCHECKED");

  if (
    cents(line.amount) !==
    line.orders.reduce((sum, order) => sum + cents(order.total), 0)
  )
    return review("AMOUNT_MISMATCH");
  if (line.orders.some((order) => (invoices.get(order.id) ?? []).length === 0))
    return review("ORDER_NOT_INVOICED");
  return {
    status: "RESOLVED",
    orderIds,
    orderNumbers,
    orderTotal: orderTotal ?? 0,
    invoiceNumbers,
  };
}

/** One payment or refund line of a PaymentIntent, as stored or as listed: the type and the signed amount (major unit). */
export interface StripeIntentLine {
  type: string;
  amount: number;
}

/**
 * A PAYMENTINTENT WITH A REFUND, DECIDED AS A WHOLE (A9 refund slice, card 6339b04c). The SimplePay refund rule (c03e9896), kept in
 * step with it, applied to the intent's ORDERS: net = payments minus refunds, from EVERY payment and refund line of the intent the
 * OS knows (the payment is often in an earlier payout).
 *
 * MEASURED on the test shop (2026-11-19): the webshop REDUCES an order's total when part of it is refunded (a payment of 22 150, a
 * refund of 10 500, the order's total 11 650), and a mixed cart (two orders, one payment) is the common case, not the exception. So
 * the rule does not need to know WHICH order a refund went back to: it reads the orders together and each order on its own.
 *
 *   net 0 (full refund)         every order has no live invoice after its credit notes (nothing billed, a storno, or a full credit
 *                               note) -> resolved; a live one -> REFUND_INVOICE_NOT_CANCELLED
 *   net = the orders' totals    (a part refunded, the orders reduced) every order has an invoice, and the live invoices of each, less
 *                               their credit notes, bill exactly THAT order's total -> resolved; an order with no invoice at all ->
 *                               ORDER_NOT_INVOICED; otherwise (or a gross not known) REFUND_INVOICE_NOT_CORRECTED
 *   anything else               REFUND_AMOUNT_UNEXPLAINED (a refund with no payment line in the OS yet, a refund over the payment, a
 *                               part refunded and the orders not reduced)
 *
 * The sign of an amount is not trusted (the SimplePay measure): the line's type says which way it goes. A cancelled credit note
 * credits nothing (barracuda #2467 on the SimplePay side).
 */
export function resolveStripeRefundIntent(
  lines: readonly StripeIntentLine[],
  orders: readonly StripeLineOrder[],
  documentsByOrder: ReadonlyMap<string, readonly SimplePayOrderDocument[]>,
): StripeLineResolution {
  const orderIds = orders.map((order) => order.id);
  const orderNumbers = orders.map((order) =>
    order.displayId === null ? order.id : String(order.displayId),
  );
  const orderTotal = orders.reduce((sum, order) => sum + cents(order.total), 0);
  const invoiceNumbers = [
    ...new Set(
      orders.flatMap((order) =>
        (documentsByOrder.get(order.id) ?? []).map(
          (document) => document.number,
        ),
      ),
    ),
  ];
  const review = (errorCode: StripeLineError): StripeLineResolution => ({
    status: "NEEDS_REVIEW",
    errorCode,
    orderIds,
    orderNumbers,
    orderTotal: orderTotal / 100,
    invoiceNumbers,
  });

  const sum = (refund: boolean) =>
    lines
      .filter((line) => STRIPE_REFUND_TYPES.includes(line.type) === refund)
      .reduce((total, line) => total + Math.abs(cents(line.amount)), 0);
  const net = sum(false) - sum(true);

  // per order: its live invoices, its credit notes, and what is billed after them (null when a gross is not known)
  const billing = orders.map((order) => {
    const documents = documentsByOrder.get(order.id) ?? [];
    const invoices = documents.filter(
      (document) => document.kind === "INVOICE",
    );
    const live = invoices.filter((document) => !document.cancelled);
    const credits = documents.filter(
      (document) => document.kind === "CORRECTION" && !document.cancelled,
    );
    const known = [...live, ...credits].every(
      (document) => document.gross !== null,
    );
    return {
      order,
      anyInvoice: invoices.length > 0,
      live: live.length,
      billed: known
        ? live.reduce((total, document) => total + cents(document.gross!), 0) -
          credits.reduce(
            (total, document) => total + Math.abs(cents(document.gross!)),
            0,
          )
        : null,
    };
  });

  const resolved = (): StripeLineResolution => ({
    status: "RESOLVED",
    orderIds,
    orderNumbers,
    orderTotal: orderTotal / 100,
    invoiceNumbers,
  });

  if (net === 0)
    // a full credit note settles a live invoice as a cancellation does
    return billing.every((entry) => entry.live === 0 || entry.billed === 0)
      ? resolved()
      : review("REFUND_INVOICE_NOT_CANCELLED");
  if (net < 0 || net !== orderTotal) return review("REFUND_AMOUNT_UNEXPLAINED");
  if (billing.some((entry) => !entry.anyInvoice))
    return review("ORDER_NOT_INVOICED");
  return billing.every(
    (entry) => entry.live > 0 && entry.billed === cents(entry.order.total),
  )
    ? resolved()
    : review("REFUND_INVOICE_NOT_CORRECTED");
}
