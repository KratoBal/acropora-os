import type { StripeLineError } from "@acropora/types";

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
 *   - a refund (`refund`, `payment_refund`): its orders and invoices are attached, but it is never RESOLVED by itself: whether the
 *     invoice was cancelled or corrected is the SimplePay refund logic (c03e9896), not built here, so a person decides
 *     (REFUND_UNCHECKED);
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
