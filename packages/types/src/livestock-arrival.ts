/**
 * THE LIVE ANIMAL ARRIVAL, SEEN FROM THE CUSTOMER'S SIDE (card f4e4832b, V2.6 S2; acrobot 2026-11-06).
 *
 * What is coming, when, and whether an interested customer may register for it. Entered by hand in the OS; no money in it
 * (a deposit is a separate, later question); a fish or an invertebrate by species or group, a unique coral by the piece
 * (an optional product link carries the piece). This is NOT the purchasing record (`ExpectedArrival`, a supplier's pro
 * forma or invoice waiting to be booked): that one has no animal, no date and no customer-facing meaning.
 *
 * Nothing in the shop reads it yet; the customer-facing parts are later slices.
 */
export const LIVESTOCK_ARRIVAL_KINDS = [
  "FISH",
  "INVERTEBRATE",
  "CORAL",
] as const;
export type LivestockArrivalKind = (typeof LIVESTOCK_ARRIVAL_KINDS)[number];

export const LIVESTOCK_ARRIVAL_KIND_LABELS: Readonly<
  Record<LivestockArrivalKind, string>
> = {
  FISH: "Hal",
  INVERTEBRATE: "Gerinctelen",
  CORAL: "Korall",
};

export const LIVESTOCK_ARRIVAL_STATUSES = [
  "ORDERED",
  "IN_TRANSIT",
  "ARRIVED",
  "CANCELLED",
] as const;
export type LivestockArrivalStatus =
  (typeof LIVESTOCK_ARRIVAL_STATUSES)[number];

export const LIVESTOCK_ARRIVAL_STATUS_LABELS: Readonly<
  Record<LivestockArrivalStatus, string>
> = {
  ORDERED: "Megrendelve",
  IN_TRANSIT: "Úton",
  ARRIVED: "Megérkezett",
  CANCELLED: "Lemondva",
};

/** The two states in which an arrival is still coming: only these may be pre-registered for. */
export const LIVESTOCK_ARRIVAL_OPEN_STATUSES: readonly LivestockArrivalStatus[] =
  ["ORDERED", "IN_TRANSIT"];

export const LIVESTOCK_ARRIVAL_LIMITS = {
  label: { min: 1, max: 120 },
  note: { max: 500 },
  quantity: { min: 1, max: 100000 },
} as const;

export interface LivestockArrival {
  id: string;
  kind: LivestockArrivalKind;
  /** What the customer will read: a species, a group, or a piece's name. */
  label: string;
  productId: string | null;
  /** The linked product's name, for the list; null without a link. */
  productName: string | null;
  /** The expected day, `YYYY-MM-DD`. */
  expectedOn: string;
  quantity: number | null;
  status: LivestockArrivalStatus;
  preorderable: boolean;
  /** Internal: never shown to a customer. */
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LivestockArrivalListResponse {
  items: LivestockArrival[];
}

/** True when an arrival in this state may be registered for. */
export function isLivestockArrivalOpen(
  status: LivestockArrivalStatus,
): boolean {
  return LIVESTOCK_ARRIVAL_OPEN_STATUSES.includes(status);
}
