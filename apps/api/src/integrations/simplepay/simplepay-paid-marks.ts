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
 *   6. a full refund is not a payment. A PARTIAL one (Balázs, 2026-11-12
 *      10:25: handle it; the shape is acrobot's, 48818 and 48823, c03e9896)
 *      is marked document by document, as the money moved:
 *        - an invoice of the full sum with its correctives (JS, HS, not
 *          cancelled) adding up to the refund: the invoice is marked with
 *          the payments, each corrective with its own refund (negative);
 *        - an invoice already of the reduced sum, no corrective: marked with
 *          what stayed paid;
 *        - anything else: CORRECTIVE_MISSING, nothing is marked (marking the
 *          net on the full invoice would leave the refund open on it, and the
 *          corrective unmarked: two false states in Számlázz.hu);
 *   7. without a refund, the COMPLETED lines add up to the invoice's gross,
 *      to the cent (a card charges the exact sum; no rounding as with cash).
 *
 * A payment's mark is dated the day SimplePay settled it (the latest
 * COMPLETED line), a corrective's the day of the latest refund; the note
 * names the SimplePay transactions, the source reference too.
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
  /**
   * A credit note or a corrective (JS, HS): it reduces the order's invoice,
   * it is not a second invoice to pay.
   */
  readonly corrective: boolean;
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
  | "CORRECTIVE_MISSING"
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
      /** The invoice's mark, then its correctives' (after a partial refund). */
      readonly marks: readonly SimplePayPaidMark[];
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
const correctedBy = (invoices: readonly CardInvoiceInput[]) =>
  invoices.reduce(
    (total, invoice) => total.plus(invoice.grossAmount.abs()),
    ZERO,
  );

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
    (invoice) =>
      !invoice.corrective && !invoice.cancelled && invoice.grossAmount.gt(0),
  );
  const correctives = input.invoices.filter(
    (invoice) => invoice.corrective && !invoice.cancelled,
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
  const latest = (lines: readonly SimplePaySettlementLineInput[]) =>
    lines.map((l) => l.transactionDate).reduce((a, b) => (a > b ? a : b));
  const date = latest(completedLines);
  const ids = completedLines.map((l) => l.transactionId).sort();
  const refundIds = refundLines.map((l) => l.transactionId).sort();
  const paymentMark = (amount: Prisma.Decimal): SimplePayPaidMark => ({
    invoiceNumber: number,
    date,
    amount: amount.toFixed(0),
    title: "bankkártya",
    note: `SimplePay, ${date}, tranzakció: ${ids.join(", ")}${
      refundIds.length ? `, visszatérítés: ${refundIds.join(", ")}` : ""
    }`,
    sourceRef: ids.join(","),
  });
  const marked = (
    marks: readonly SimplePayPaidMark[],
  ): SimplePayOrderDecision => ({
    orderKey: input.orderKey,
    markable: true,
    marks,
  });

  if (refundLines.length === 0)
    return completed.equals(invoice.grossAmount)
      ? marked([paymentMark(completed)])
      : skip("AMOUNT_MISMATCH", number);

  const kept = completed.minus(refunded);
  if (kept.lte(0)) return skip("REFUNDED", number);
  // the invoice was issued for the reduced order: what stayed paid is its gross
  if (correctives.length === 0 && invoice.grossAmount.equals(kept))
    return marked([paymentMark(kept)]);
  // the invoice of the full sum, its correctives crediting the refund (their sign is not trusted)
  if (
    correctives.length === 0 ||
    !invoice.grossAmount.equals(completed) ||
    !correctedBy(correctives).equals(refunded)
  )
    return skip("CORRECTIVE_MISSING", number);
  for (const corrective of correctives) {
    if (corrective.paymentsKnown === null)
      return skip("PAYMENTS_UNKNOWN", corrective.invoiceNumber);
    if (!corrective.paidAmount.isZero())
      return skip("ALREADY_PAID", corrective.invoiceNumber);
    if (corrective.currency.toUpperCase() !== "HUF")
      return skip("FOREIGN_CURRENCY", corrective.invoiceNumber);
  }
  const refundDate = latest(refundLines);
  return marked([
    paymentMark(completed),
    ...[...correctives]
      .sort((a, b) => a.invoiceNumber.localeCompare(b.invoiceNumber))
      .map((corrective) => ({
        invoiceNumber: corrective.invoiceNumber,
        date: refundDate,
        amount: corrective.grossAmount.abs().negated().toFixed(0),
        title: "bankkártya" as const,
        note: `SimplePay visszatérítés, ${refundDate}, tranzakció: ${refundIds.join(", ")}`,
        sourceRef: refundIds.join(","),
      })),
  ]);
}
