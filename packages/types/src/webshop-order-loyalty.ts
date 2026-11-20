/**
 * THE WEB SHOP CUSTOMER'S LOYALTY POINTS, AS THE ORDER PAGE SHOWS THEM (card dfb79916, second slice).
 *
 * The ledger lives in the shop (Medusa module `loyalty`, commerce #808): the OS reads the balance and the newest rows,
 * and credits or debits by hand through the shop's admin route. The OS keeps nothing of its own: there is no copy of the
 * balance here that could drift from the shop's.
 *
 * `available: false` means there are no points to show: the order was placed without an account (a guest has no
 * ledger), so the page says so instead of a zero that would read as "has no points".
 */
export const WEBSHOP_LOYALTY_REASON_MAX = 500;
export const WEBSHOP_LOYALTY_POINTS_MAX = 10_000_000;

export interface WebshopLoyaltyEntry {
  id: string;
  /** `accrual`, `redemption`, `adjustment` or `reversal` */
  kind: string;
  /** signed whole points: a credit is positive */
  points: number;
  orderId: string | null;
  reason: string;
  actor: string;
  createdAt: string;
}

export type WebshopOrderLoyalty =
  | { available: false }
  | { available: true; balance: number; entries: WebshopLoyaltyEntry[] };

/** A manual credit (positive) or debit (negative). The reason is required: a movement nobody can explain gets disputed. */
export interface WebshopLoyaltyAdjustmentInput {
  points: number;
  reason: string;
}

export interface WebshopLoyaltyAdjustmentResult {
  /** the balance after the movement */
  balance: number;
  /** `false`: the same request had already been stored (a retry), nothing was added */
  created: boolean;
  loyalty: WebshopOrderLoyalty;
}

/** `Number.isSafeInteger` and the bound, one definition for the form, the DTO and the service. */
export function isLoyaltyPoints(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value !== 0 &&
    Math.abs(value) <= WEBSHOP_LOYALTY_POINTS_MAX
  );
}
