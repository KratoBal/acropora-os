import type { SimplePayLineError } from "@acropora/types";

/**
 * WHICH ORDER AND INVOICE A SIMPLEPAY PAYMENT PAID. Local data only, no
 * webshop call (the same rule as the GLS settlement, gls-cod-resolution.ts).
 *
 * The merchant transaction ID carries the UNAS order: the part after the "T"
 * is the end of the order key ("111737061T628506" -> "47679-628506", our
 * SalesOrder "UNAS-47679-628506"). Measured 5 of 5 on 2026-09-30.
 *
 * The order, per line:
 *   1. no order key in the ID -> review;
 *   2. the orders whose number ends in "-<key>": none -> review; several ->
 *      the one whose total is the amount paid, or review;
 *   3. the order's total must be the amount paid, else review (the payment
 *      is kept apart from a changed order, not booked against it);
 *   4. the order's outgoing invoices resolve the line; none -> review.
 */

export interface SimplePayOrderCandidate {
  orderNumber: string;
  totalGross: number;
  invoiceNumbers: readonly string[];
}

export type SimplePayLineResolution =
  | {
      status: "RESOLVED";
      orderNumber: string;
      orderTotal: number;
      invoiceNumbers: string[];
    }
  | {
      status: "NEEDS_REVIEW";
      errorCode: SimplePayLineError;
      orderNumber: string | null;
      orderTotal: number | null;
    };

/** Money to the cent, so that a stored Decimal and a CSV amount compare. */
const cents = (value: number) => Math.round(value * 100);

export function resolveSimplePayLine(
  line: { orderKeySuffix: string | null; amount: number },
  candidates: readonly SimplePayOrderCandidate[],
): SimplePayLineResolution {
  const review = (
    errorCode: SimplePayLineError,
    order: SimplePayOrderCandidate | null = null,
  ): SimplePayLineResolution => ({
    status: "NEEDS_REVIEW",
    errorCode,
    orderNumber: order?.orderNumber ?? null,
    orderTotal: order?.totalGross ?? null,
  });

  if (!line.orderKeySuffix) return review("REFERENCE_UNKNOWN");
  if (candidates.length === 0) return review("ORDER_NOT_FOUND");

  let order = candidates[0]!;
  if (candidates.length > 1) {
    const paid = candidates.filter(
      (candidate) => cents(candidate.totalGross) === cents(line.amount),
    );
    if (paid.length !== 1) return review("ORDER_AMBIGUOUS");
    order = paid[0]!;
  }
  if (cents(order.totalGross) !== cents(line.amount))
    return review("AMOUNT_MISMATCH", order);
  if (order.invoiceNumbers.length === 0)
    return review("ORDER_NOT_INVOICED", order);
  return {
    status: "RESOLVED",
    orderNumber: order.orderNumber,
    orderTotal: order.totalGross,
    invoiceNumbers: [...order.invoiceNumbers],
  };
}
