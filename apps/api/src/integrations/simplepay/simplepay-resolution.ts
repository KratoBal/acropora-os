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

/** One SimplePay line of an order, from any weekly report. */
export interface SimplePayOrderLine {
  transactionStatus: string;
  amount: number;
}

/**
 * One of the order's outgoing documents, from Számlázz.hu's feed or from our
 * own invoice table. `gross` is null where the source does not carry it (the
 * UNAS invoice mirror has numbers only).
 */
export interface SimplePayOrderDocument {
  number: string;
  kind: "INVOICE" | "STORNO" | "CORRECTION";
  gross: number | null;
  cancelled: boolean;
}

/**
 * AN ORDER WITH A REFUND, DECIDED AS A WHOLE (c03e9896). A refund line is
 * never "the order's total is different": its order is decided by every
 * SimplePay line it has, from any report (the payment is often a week
 * earlier), as net = payments minus refunds.
 *
 *   net 0 (full refund): no live invoice (nothing to bill, or the invoice is
 *     cancelled), or a credit note to the full sum -> resolved; a live one
 *     -> REFUND_INVOICE_NOT_CANCELLED.
 *   net = the order's total (partial refund, the order already reduced): one
 *     live invoice of exactly the net, or the live invoices less their
 *     correctives to exactly the net -> resolved; no invoice at all ->
 *     ORDER_NOT_INVOICED; otherwise (or a gross not known) ->
 *     REFUND_INVOICE_NOT_CORRECTED.
 *   anything else, or a line status other than COMPLETED and REFUND ->
 *     REFUND_AMOUNT_UNEXPLAINED.
 *
 * The sign of a REFUND amount is not trusted (measured negative, 2026-11-12):
 * the status says which way it goes.
 */
export function resolveSimplePayRefundOrder(
  lines: readonly SimplePayOrderLine[],
  candidates: readonly SimplePayOrderCandidate[],
  documents: readonly SimplePayOrderDocument[],
): SimplePayLineResolution {
  if (candidates.length !== 1)
    return {
      status: "NEEDS_REVIEW",
      errorCode:
        candidates.length === 0 ? "ORDER_NOT_FOUND" : "ORDER_AMBIGUOUS",
      orderNumber: null,
      orderTotal: null,
    };
  const order = candidates[0]!;
  const review = (errorCode: SimplePayLineError): SimplePayLineResolution => ({
    status: "NEEDS_REVIEW",
    errorCode,
    orderNumber: order.orderNumber,
    orderTotal: order.totalGross,
  });
  const resolved = (): SimplePayLineResolution => ({
    status: "RESOLVED",
    orderNumber: order.orderNumber,
    orderTotal: order.totalGross,
    invoiceNumbers: documents.map((document) => document.number),
  });

  const sum = (status: string) =>
    lines
      .filter((line) => line.transactionStatus === status)
      .reduce((total, line) => total + Math.abs(cents(line.amount)), 0);
  if (
    lines.some(
      (line) =>
        line.transactionStatus !== "COMPLETED" &&
        line.transactionStatus !== "REFUND",
    )
  )
    return review("REFUND_AMOUNT_UNEXPLAINED");
  const net = sum("COMPLETED") - sum("REFUND");

  const invoices = documents.filter((document) => document.kind === "INVOICE");
  const live = invoices.filter((document) => !document.cancelled);
  // a cancelled corrective credits nothing (barracuda #2467): a storno of a credit note leaves the invoice live
  const corrections = documents.filter(
    (document) => document.kind === "CORRECTION" && !document.cancelled,
  );
  // what the live invoices bill after their correctives; null if a gross is not known
  const billed = [...live, ...corrections].every(
    (document) => document.gross !== null,
  )
    ? live.reduce((total, document) => total + cents(document.gross!), 0) -
      corrections.reduce(
        (total, document) => total + Math.abs(cents(document.gross!)),
        0,
      )
    : null;

  if (net === 0)
    // a full credit note settles a live invoice as a cancellation does
    return live.length === 0 || billed === 0
      ? resolved()
      : review("REFUND_INVOICE_NOT_CANCELLED");
  if (net < 0 || net !== cents(order.totalGross))
    return review("REFUND_AMOUNT_UNEXPLAINED");
  if (invoices.length === 0) return review("ORDER_NOT_INVOICED");
  return live.length > 0 && billed === net
    ? resolved()
    : review("REFUND_INVOICE_NOT_CORRECTED");
}
