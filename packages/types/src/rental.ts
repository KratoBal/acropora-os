/**
 * A RENTAL: one device to one customer, from a start to a planned return (task eszkozberles, S2; Balázs, 2026-11-06).
 *
 * The device's fee, deposit, replacement value and accessories are COPIED onto the rental when it is recorded: the contract
 * prints what was agreed that day, and a later price change in Settings must not rewrite it. So are the contract's text and
 * the two late-return settings (S3; acrobot 45779 on barracuda's #2360 review): a reprint is the contract that was signed. The deposit may differ from the
 * device's default (the desk may agree on another one).
 *
 * At most one OPEN rental per device: a partial unique index in the migration, not only a check in the service.
 */
export const RENTAL_STATUSES = ["OPEN", "RETURNED"] as const;
export type RentalStatus = (typeof RENTAL_STATUSES)[number];

export interface RentalCustomerSummary {
  id: string;
  customerNumber: string;
  displayName: string;
  phone: string | null;
  email: string | null;
  /** The default (else the first) address, one line: "1234 Budapest, Fő utca 1." */
  address: string | null;
}

export interface Rental {
  id: string;
  /** The contract number, e.g. `BER-...`; printed on the contract. */
  rentalNumber: string;
  status: RentalStatus;
  equipment: { id: string; name: string; serialNumber: string | null };
  customer: RentalCustomerSummary;
  startsAt: string;
  plannedReturnAt: string;
  dailyFeeHuf: number;
  depositHuf: number;
  replacementValueHuf: number;
  /** The late-fee multiplier in force when the rental was recorded; null when none was set then (the contract says so). */
  lateFeeMultiplier: number | null;
  /** The late days after which the replacement value may be claimed, as in force when recorded; null when none was set. */
  replacementAfterDays: number | null;
  accessories: string | null;
  /** The fee for the planned period: started 24-hour periods times the daily fee. */
  expectedFeeHuf: number;
  note: string | null;
  returnedAt: string | null;
  createdAt: string;
}

export interface RentalListResponse {
  items: Rental[];
}

export interface RentalCustomerMatchResponse {
  items: RentalCustomerSummary[];
}

export const RENTAL_LIMITS = {
  note: { max: 2000 },
  /** A rental longer than a year is a typo in the date, not a rental. */
  maxDays: 366,
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Started 24-hour periods between two instants, at least one (Balázs: "a díj a megkezdett 24 órák szerint"). Counted in real
 * hours, so a period across a clock change is still 24 hours long. `null` when the end is not after the start.
 */
export function rentalPeriodCount(
  startsAt: string | Date,
  endsAt: string | Date,
): number | null {
  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
    return null;
  return Math.ceil((end - start) / DAY_MS);
}

/** The fee for a period: started 24-hour periods times the daily fee; `null` when the period is not valid. */
export function rentalFeeHuf(
  startsAt: string | Date,
  endsAt: string | Date,
  dailyFeeHuf: number,
): number | null {
  const periods = rentalPeriodCount(startsAt, endsAt);
  return periods === null ? null : periods * dailyFeeHuf;
}
