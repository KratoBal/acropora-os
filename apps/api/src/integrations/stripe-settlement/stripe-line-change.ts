/**
 * WHETHER A STORED STRIPE LINE DIFFERS FROM WHAT THE NEXT RUN READ. A run that finds a line unchanged must not write it: the
 * line's `updatedAt` is the version a person's approval is checked against, and a rewrite of identical data would move it and
 * make an approval that was opened before the run fail with a conflict for no reason.
 */
type DecimalLike = { toFixed(digits: number): string };

export interface StripeLineFields {
  type: string;
  reportingCategory: string | null;
  stripeCreatedAt: Date;
  currency: string;
  amount: DecimalLike;
  fee: DecimalLike;
  net: DecimalLike;
  paymentIntentId: string | null;
  chargeId: string | null;
  refundId: string | null;
  webshopOrderIds: readonly string[];
  orderNumbers: readonly string[];
  orderTotal: DecimalLike | null;
  invoiceNumbers: readonly string[];
  status: string;
  resolutionSource: string | null;
  errorCode: string | null;
}

const same = (a: DecimalLike | null, b: DecimalLike | null) =>
  a === null || b === null ? a === b : a.toFixed(4) === b.toFixed(4);
const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

export function stripeLineChanged(
  stored: StripeLineFields,
  next: StripeLineFields,
): boolean {
  return !(
    stored.type === next.type &&
    stored.reportingCategory === next.reportingCategory &&
    stored.stripeCreatedAt.getTime() === next.stripeCreatedAt.getTime() &&
    stored.currency === next.currency &&
    same(stored.amount, next.amount) &&
    same(stored.fee, next.fee) &&
    same(stored.net, next.net) &&
    stored.paymentIntentId === next.paymentIntentId &&
    stored.chargeId === next.chargeId &&
    stored.refundId === next.refundId &&
    sameList(stored.webshopOrderIds, next.webshopOrderIds) &&
    sameList(stored.orderNumbers, next.orderNumbers) &&
    same(stored.orderTotal, next.orderTotal) &&
    sameList(stored.invoiceNumbers, next.invoiceNumbers) &&
    stored.status === next.status &&
    stored.resolutionSource === next.resolutionSource &&
    stored.errorCode === next.errorCode
  );
}
