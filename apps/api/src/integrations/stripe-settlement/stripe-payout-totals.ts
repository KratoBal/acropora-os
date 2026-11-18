import type {
  StripeLineStatus,
  StripePayoutError,
  StripePayoutStatus,
} from "@acropora/types";

import {
  STRIPE_FEE_TYPES,
  STRIPE_PAYMENT_TYPES,
  STRIPE_REFUND_TYPES,
} from "./stripe-resolution.js";

/**
 * A PAYOUT'S COUNTS, TOTALS AND STATUS FROM ITS LINES (one reading, used by the save and by an approval). Cents, so the sums are
 * exact:
 *   gross    the payments' amounts            refund   the refunds' amounts (negative)
 *   fee      the fee carried on each line, plus the standalone fee lines (their amounts are negative: a fee paid, shown positive)
 *   net      every line's net: it must be what Stripe paid out, else TOTAL_MISMATCH
 * COMPLETED only when no line waits for a person AND the payout itself has no error. An empty payout is not settled by emptiness
 * either: Stripe paid money out, so zero lines against an amount is a TOTAL_MISMATCH (the feed returned nothing it should have).
 */
export interface StripeTotalsLine {
  type: string;
  /** Cents, signed. */
  amount: number;
  fee: number;
  net: number;
  status: StripeLineStatus;
}

export interface StripePayoutTotals {
  status: StripePayoutStatus;
  errorCode: StripePayoutError | null;
  lineCount: number;
  unresolvedLineCount: number;
  grossCents: number;
  refundCents: number;
  feeCents: number;
  netCents: number;
}

export function payoutTotals(
  lines: readonly StripeTotalsLine[],
  context: { payoutAmountCents: number; errorCode: StripePayoutError | null },
): StripePayoutTotals {
  let gross = 0;
  let refund = 0;
  let fee = 0;
  let net = 0;
  let unresolved = 0;
  for (const line of lines) {
    if (STRIPE_PAYMENT_TYPES.includes(line.type)) gross += line.amount;
    else if (STRIPE_REFUND_TYPES.includes(line.type)) refund += line.amount;
    fee += STRIPE_FEE_TYPES.includes(line.type) ? -line.amount : line.fee;
    net += line.net;
    if (line.status === "NEEDS_REVIEW") unresolved += 1;
  }
  const errorCode =
    context.errorCode ??
    (net !== context.payoutAmountCents ? "TOTAL_MISMATCH" : null);
  return {
    status:
      unresolved === 0 && errorCode === null ? "COMPLETED" : "NEEDS_REVIEW",
    errorCode,
    lineCount: lines.length,
    unresolvedLineCount: unresolved,
    grossCents: gross,
    refundCents: refund,
    feeCents: fee,
    netCents: net,
  };
}
