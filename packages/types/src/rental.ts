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
  /** THE RETURN (S4), null while the device is out: what the desk settled when it took the device back. */
  settlement: RentalReturnRecord | null;
  createdAt: string;
}

/** What the return recorded (task eszkozberles, S4). */
export interface RentalReturnRecord {
  /** Started 24-hour periods of the actual time out, times the daily fee (Balázs's rule). */
  feeHuf: number;
  /** The late surcharge with the multiplier agreed on the rental; null when none was agreed (not charged, not guessed). */
  lateSurchargeHuf: number | null;
  depositKeptHuf: number;
  depositKeptReason: string | null;
}

export interface RentalListResponse {
  items: Rental[];
  /** More rentals exist than the list carries (barracuda, #2274 b): the page says so instead of silently showing a part. */
  truncated: boolean;
}

/**
 * THE SETTLEMENT OF A RETURN (task eszkozberles, S4; Balázs, Discord 1568165192779571222: "tényleges idő, díj a megkezdett 24
 * órák szerint, kaució vissza vagy levonás okkal"). Pure, so the page's preview and the server's record are one rule.
 *
 *   fee              started 24-hour periods from the start to the ACTUAL return, times the daily fee: a late day is a day of
 *                    rental like the others.
 *   late surcharge   only for the started periods after the PLANNED return, and only with a multiplier: the late periods times
 *                    the daily fee times (multiplier - 1), on top of the fee. With no multiplier set (Balázs's open question,
 *                    acrobot 44187) it is null: not charged and not guessed, and the page says it is not set.
 *   replacement      when the late days EXCEED `replacementAfterDays` (the contract's words) the full replacement value MAY be claimed: a flag for the desk, never
 *                    an automatic charge. Null days: no flag.
 */
export interface RentalSettlement {
  periods: number;
  feeHuf: number;
  latePeriods: number;
  lateSurchargeHuf: number | null;
  lateFeeMultiplier: number | null;
  replacementClaimable: boolean;
}

export function rentalSettlement(input: {
  startsAt: string | Date;
  plannedReturnAt: string | Date;
  returnedAt: string | Date;
  dailyFeeHuf: number;
  lateFeeMultiplier: number | null;
  replacementAfterDays: number | null;
}): RentalSettlement | null {
  const periods = rentalPeriodCount(input.startsAt, input.returnedAt);
  if (periods === null) return null;
  const latePeriods =
    rentalPeriodCount(input.plannedReturnAt, input.returnedAt) ?? 0;
  const multiplier = input.lateFeeMultiplier;
  const lateSurchargeHuf =
    latePeriods === 0
      ? 0
      : multiplier === null
        ? null
        : Math.round(
            latePeriods * input.dailyFeeHuf * Math.max(0, multiplier - 1),
          );
  return {
    periods,
    feeHuf: periods * input.dailyFeeHuf,
    latePeriods,
    lateSurchargeHuf,
    lateFeeMultiplier: latePeriods === 0 ? null : multiplier,
    replacementClaimable:
      input.replacementAfterDays !== null &&
      // the contract: "ha a késedelem a N napot MEGHALADJA"
      latePeriods > input.replacementAfterDays,
  };
}

/**
 * What the return panel shows before the desk confirms (S4): the settlement counted by the server's clock (or the time the
 * desk gave), and the settings it was counted with, so the page can say which of them is still not set.
 */
export interface RentalReturnPreview {
  returnedAt: string;
  settlement: RentalSettlement;
  /** The days agreed on the rental; null when none were set then (acrobot 44187): the page says so, not a number. */
  replacementAfterDays: number | null;
  depositHuf: number;
  replacementValueHuf: number;
}

export interface RentalReturnInput {
  /** When the device came back; the server's now when omitted. Not in the future, not before the start. */
  returnedAt?: string;
  /** The part of the deposit kept, 0 to the whole deposit. */
  depositKeptHuf: number;
  /** Required when anything is kept: the reason is what the renter is told. */
  depositKeptReason?: string | null;
}

export interface RentalCustomerMatchResponse {
  items: RentalCustomerSummary[];
}

export const RENTAL_LIMITS = {
  note: { max: 2000 },
  depositKeptReason: { max: 500 },
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
