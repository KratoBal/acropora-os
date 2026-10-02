import { Prisma } from "@acropora/database";
import { paymentStateOf, type OutgoingMissingPayments } from "@acropora/types";

/**
 * WHICH OF OUR CARD INVOICES A SIMPLEPAY SETTLEMENT PAID, AND MAY BE MARKED
 * PAID IN SZÁMLÁZZ.HU (Balázs, 2026-10-01 21:35 UTC: mark the paid invoices
 * from the bank, GLS, Foxpost and SimplePay too; acrobot 25994). The same
 * shape as the GLS marks (gls-cod-paid-marks.ts): a pure decision, a dry run
 * for Balázs, and the real write as a separate, approved step.
 *
 * One webshop order at a time, keyed as #1380 keys it: the invoice's order
 * number "47679-NNNNNN" to the settlement line's `orderKeySuffix`. Every
 * settlement line of the order counts, from any weekly report, so a refund
 * reported a week later still holds the payment back.
 *
 * An order is MARKABLE only when all hold:
 *   1. exactly one live invoice (not cancelled, positive gross) on the order;
 *   2. its payments are known and nothing is recorded yet (Számlázz.hu's own
 *      record always wins, as on the list);
 *   3. it is a card invoice (`CARD_AT_ORDER`): a transfer or COD invoice is
 *      not marked from a card settlement, whatever the settlement says;
 *   4. HUF on both sides;
 *   5. only COMPLETED and REFUND lines (the two statuses measured live; any
 *      other is a question, not a guess);
 *   6. no REFUND line: a full refund is not a payment, and a partial one is
 *      Balázs's question (a corrective invoice, or a smaller payment);
 *   7. the COMPLETED lines add up to the invoice's gross, to the cent (a card
 *      charges the exact sum; no rounding as with cash).
 *
 * The mark is the gross, dated the day SimplePay settled the payment (the
 * latest COMPLETED line), and the note names the SimplePay transactions.
 */

export interface SimplePaySettlementLineInput {
  readonly transactionId: string;
  readonly transactionStatus: string;
  /** As SimplePay reports it; the sign of a REFUND is not known, so abs. */
  readonly amount: Prisma.Decimal;
  readonly currency: string;
  /** `YYYY-MM-DD`, the transaction's day. */
  readonly transactionDate: string;
}

/** One of our outgoing invoices on the order (Számlázz.hu's feed). */
export interface CardInvoiceInput {
  readonly invoiceNumber: string;
  readonly grossAmount: Prisma.Decimal;
  readonly currency: string;
  readonly cancelled: boolean;
  /** `null`: not yet projected with its payments, so not provably unpaid. */
  readonly paymentsKnown: boolean | null;
  readonly paidAmount: Prisma.Decimal;
  /** `outgoingMissingPayments` of its payment method. */
  readonly missingPayments: OutgoingMissingPayments;
}

export type SimplePayOrderSkip =
  | "NO_INVOICE"
  | "CANCELLED"
  | "SEVERAL_INVOICES"
  | "PAYMENTS_UNKNOWN"
  | "ALREADY_PAID"
  | "PARTLY_PAID"
  | "NOT_CARD"
  | "FOREIGN_CURRENCY"
  | "UNKNOWN_STATUS"
  | "NOT_SETTLED"
  | "REFUNDED"
  | "PARTLY_REFUNDED"
  | "AMOUNT_MISMATCH";

export interface SimplePayPaidMark {
  readonly invoiceNumber: string;
  readonly date: string;
  /** The invoice's gross, as Számlázz.hu's `osszeg`. */
  readonly amount: string;
  readonly title: "bankkártya";
  readonly note: string;
  /** The SimplePay transactions the mark rests on, ascending, comma-joined. */
  readonly sourceRef: string;
}

export type SimplePayOrderDecision =
  | {
      readonly orderKey: string;
      readonly markable: true;
      readonly mark: SimplePayPaidMark;
    }
  | {
      readonly orderKey: string;
      readonly markable: false;
      readonly reason: SimplePayOrderSkip;
      /** `null` when the order has no invoice, or several. */
      readonly invoiceNumber: string | null;
      /** The settled COMPLETED and REFUND sums, for the dry run's line. */
      readonly completed: string;
      readonly refunded: string;
    };

const ZERO = new Prisma.Decimal(0);
const sum = (lines: readonly SimplePaySettlementLineInput[]) =>
  lines.reduce((total, line) => total.plus(line.amount.abs()), ZERO);

export function decideSimplePayOrder(input: {
  readonly orderKey: string;
  readonly lines: readonly SimplePaySettlementLineInput[];
  readonly invoices: readonly CardInvoiceInput[];
}): SimplePayOrderDecision {
  const completedLines = input.lines.filter(
    (l) => l.transactionStatus === "COMPLETED",
  );
  const refundLines = input.lines.filter(
    (l) => l.transactionStatus === "REFUND",
  );
  const completed = sum(completedLines);
  const refunded = sum(refundLines);
  const skip = (
    reason: SimplePayOrderSkip,
    invoiceNumber: string | null,
  ): SimplePayOrderDecision => ({
    orderKey: input.orderKey,
    markable: false,
    reason,
    invoiceNumber,
    completed: completed.toFixed(0),
    refunded: refunded.toFixed(0),
  });

  const live = input.invoices.filter(
    (invoice) => !invoice.cancelled && invoice.grossAmount.gt(0),
  );
  if (input.invoices.length === 0) return skip("NO_INVOICE", null);
  if (live.length === 0)
    return skip("CANCELLED", input.invoices[0]!.invoiceNumber);
  // which invoice the card paid is not ours to guess
  if (live.length > 1) return skip("SEVERAL_INVOICES", null);
  const invoice = live[0]!;
  const number = invoice.invoiceNumber;

  if (invoice.paymentsKnown === null) return skip("PAYMENTS_UNKNOWN", number);
  // already paid by any source: never a second payment next to it
  const state = paymentStateOf({
    paymentsKnown: true,
    paidAmount: invoice.paidAmount.toFixed(),
    grossAmount: invoice.grossAmount.toFixed(),
    currency: invoice.currency,
  });
  if (state === "PAID") return skip("ALREADY_PAID", number);
  if (state === "PARTIAL") return skip("PARTLY_PAID", number);
  if (invoice.missingPayments !== "CARD_AT_ORDER")
    return skip("NOT_CARD", number);
  if (
    invoice.currency.toUpperCase() !== "HUF" ||
    input.lines.some((l) => l.currency.toUpperCase() !== "HUF")
  )
    return skip("FOREIGN_CURRENCY", number);
  if (completedLines.length + refundLines.length !== input.lines.length)
    return skip("UNKNOWN_STATUS", number);
  if (completedLines.length === 0) return skip("NOT_SETTLED", number);
  if (refundLines.length > 0)
    return skip(
      refunded.gte(completed) ? "REFUNDED" : "PARTLY_REFUNDED",
      number,
    );
  if (!completed.equals(invoice.grossAmount))
    return skip("AMOUNT_MISMATCH", number);

  const date = completedLines
    .map((l) => l.transactionDate)
    .reduce((a, b) => (a > b ? a : b));
  const ids = completedLines.map((l) => l.transactionId).sort();
  return {
    orderKey: input.orderKey,
    markable: true,
    mark: {
      invoiceNumber: number,
      date,
      amount: invoice.grossAmount.toFixed(0),
      title: "bankkártya",
      note: `SimplePay, ${date}, tranzakció: ${ids.join(", ")}`,
      sourceRef: ids.join(","),
    },
  };
}
