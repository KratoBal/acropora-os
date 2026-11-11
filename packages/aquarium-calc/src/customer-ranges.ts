/**
 * THE APPROVED WATER-VALUE BANDS THAT MAY BE SHOWN TO A CUSTOMER (Acropora OS card ce6c5cc9, V3.4 slice S1; plan: the card's V3.4
 * TERV comment of 2026-11-10; Balázs's decision 2026-11-11 11:44:46 UTC, Eldöntendő thread, msg 1570041598300004414, "mind jó",
 * on the proposals of msg 1570040967308910646).
 *
 * WHY THIS REGISTER EXISTS, IN THE MODEL OF `DAILY_LIMITS`: the internal recommendation (2b3983e1) compares a measurement with a
 * target band that a COLLEAGUE approves before it reaches anybody. The customer path has no colleague: what the self-service
 * output says goes straight to the customer. So a band may be used for a customer only when it is in THIS list with the state
 * `JOVAHAGYVA` and the name of who approved it and when; the Figma proposal's bands
 * (`AQUARIUM_MEASUREMENT_TARGET_RANGE`) are "a proposal, not a measurement" and are NOT a source here. "No approved band" is not
 * advice: the answer says so, and no deviation is computed from a band nobody approved.
 *
 * WHAT IS APPROVED TODAY (a), the sea-water bands only: KH 7 to 9, calcium 380 to 450, magnesium 1250 to 1350, nitrate 0 to 10.
 * PHOSPHATE IS NOT APPROVED, AND NOT BY ACCIDENT: its entry is a PROPOSAL, and even flipping its state to `JOVAHAGYVA` does not open
 * it (`PHOSPHATE_NAMED_APPROVAL` below must be set too, to the named word of Balázs about the phosphate band for a customer: the
 * ReefClub phosphate target range is not to go out without it). FRESH WATER IS NOT APPROVED: there is no entry, and the answer for
 * it is "no approved band", never a sea-water number (a sea-water value taken over would read as WRONG advice, plan of 2026-09).
 *
 * A band change is a change of THIS file (with the approval's author, time and source), and the `CUSTOMER_RANGES_VERSION` moves
 * with it, so an answer can name the register it was computed under (the same rule as `RECOMMENDATION_FRAME_VERSION`).
 */
export const CUSTOMER_RANGES_VERSION = "vevoi-savok-2026-11-11-v1";

/** The parameters the customer path covers (the plan's list: KH, Ca, Mg, NO3, PO4). */
export const CUSTOMER_RANGE_PARAMETERS = [
  "KH",
  "KALCIUM",
  "MAGNEZIUM",
  "NITRAT",
  "FOSZFAT",
] as const;
export type CustomerRangeParameter = (typeof CUSTOMER_RANGE_PARAMETERS)[number];

/** Only sea water has an entry; the type says so, so a fresh-water band cannot be added by accident. */
export type CustomerRangeWaterType = "TENGERI";

export type CustomerRangeApproval = "JOVAHAGYVA" | "JAVASLAT";

export interface CustomerRange {
  parameter: CustomerRangeParameter;
  waterType: CustomerRangeWaterType;
  /** Both ends belong to the band: a value equal to `min` or `max` is in the band. */
  min: number;
  max: number;
  unit: "dKH" | "mg/l";
  approval: CustomerRangeApproval;
  /** Who approved it and when, with the source; null for a proposal. */
  approvedBy: string | null;
}

const APPROVAL_2026_11_11 =
  "Balázs 2026-11-11 11:44:46 UTC, Eldöntendő szál, msg 1570041598300004414 (a javaslat: msg 1570040967308910646)";

export const CUSTOMER_RANGES: readonly CustomerRange[] = [
  {
    parameter: "KH",
    waterType: "TENGERI",
    min: 7,
    max: 9,
    unit: "dKH",
    approval: "JOVAHAGYVA",
    approvedBy: APPROVAL_2026_11_11,
  },
  {
    parameter: "KALCIUM",
    waterType: "TENGERI",
    min: 380,
    max: 450,
    unit: "mg/l",
    approval: "JOVAHAGYVA",
    approvedBy: APPROVAL_2026_11_11,
  },
  {
    parameter: "MAGNEZIUM",
    waterType: "TENGERI",
    min: 1250,
    max: 1350,
    unit: "mg/l",
    approval: "JOVAHAGYVA",
    approvedBy: APPROVAL_2026_11_11,
  },
  {
    parameter: "NITRAT",
    waterType: "TENGERI",
    min: 0,
    max: 10,
    unit: "mg/l",
    approval: "JOVAHAGYVA",
    approvedBy: APPROVAL_2026_11_11,
  },
  {
    // A PROPOSAL (the Figma sample's number), NOT approved for a customer: Balázs 2026-11-11 accepted "foszfát NEM".
    parameter: "FOSZFAT",
    waterType: "TENGERI",
    min: 0,
    max: 0.1,
    unit: "mg/l",
    approval: "JAVASLAT",
    approvedBy: null,
  },
];

/**
 * THE SECOND LOCK ON PHOSPHATE: null today. It opens only with the named, separate word of Balázs about the phosphate band for a
 * customer (who, when, where), written here. An entry marked `JOVAHAGYVA` is not enough on its own, so a later edit of the list
 * alone cannot let the ReefClub phosphate target range out.
 */
export const PHOSPHATE_NAMED_APPROVAL: string | null = null;

export interface CustomerRangeOptions {
  ranges?: readonly CustomerRange[];
  phosphateNamedApproval?: string | null;
}

/**
 * The band that may be shown to a customer for this parameter and water type, or `null`: no entry, a proposal, an approval without a
 * named approver, a band with a bad shape, phosphate without its second lock, or any water type but the sea.
 */
export function customerRangeFor(
  parameter: string,
  waterType: string | null | undefined,
  options: CustomerRangeOptions = {},
): CustomerRange | null {
  if (waterType !== "TENGERI") return null;
  const ranges = options.ranges ?? CUSTOMER_RANGES;
  const phosphateApproval =
    options.phosphateNamedApproval === undefined
      ? PHOSPHATE_NAMED_APPROVAL
      : options.phosphateNamedApproval;
  const range = ranges.find(
    (entry) => entry.parameter === parameter && entry.waterType === waterType,
  );
  if (!range) return null;
  if (range.approval !== "JOVAHAGYVA") return null;
  if (!range.approvedBy || range.approvedBy.trim() === "") return null;
  if (
    !Number.isFinite(range.min) ||
    !Number.isFinite(range.max) ||
    range.min >= range.max
  )
    return null;
  if (
    parameter === "FOSZFAT" &&
    (!phosphateApproval || phosphateApproval.trim() === "")
  )
    return null;
  return range;
}

export type CustomerDeviationStatus =
  /** Below the approved band. */
  | "ALATTA"
  /** Above the approved band. */
  | "FELETTE"
  | "TARTOMANYBAN"
  /** There is no approved band for this parameter and water type: NOT advice, and no deviation is claimed. */
  | "NINCS_JOVAHAGYOTT_TARTOMANY"
  /** There is no usable measured value. */
  | "NINCS_ERTEK";

export interface CustomerDeviation {
  parameter: string;
  status: CustomerDeviationStatus;
  value: number | null;
  /** The band the comparison used; null for the two "no" statuses. */
  range: { min: number; max: number; unit: CustomerRange["unit"] } | null;
}

/**
 * THE DEVIATION OF ONE MEASURED VALUE FROM THE APPROVED BAND, and only from it: without an approved band the status is
 * `NINCS_JOVAHAGYOTT_TARTOMANY` with no band and no direction (the order matters: a value is not even looked at before the band is
 * known to be approved). The band's ends are inside it. A value that is not a finite number is `NINCS_ERTEK`, never "in the band".
 */
export function customerDeviation(
  parameter: string,
  value: number | null | undefined,
  waterType: string | null | undefined,
  options: CustomerRangeOptions = {},
): CustomerDeviation {
  const range = customerRangeFor(parameter, waterType, options);
  if (!range)
    return {
      parameter,
      status: "NINCS_JOVAHAGYOTT_TARTOMANY",
      value: null,
      range: null,
    };
  if (typeof value !== "number" || !Number.isFinite(value))
    return { parameter, status: "NINCS_ERTEK", value: null, range: null };
  const band = { min: range.min, max: range.max, unit: range.unit };
  if (value < range.min)
    return { parameter, status: "ALATTA", value, range: band };
  if (value > range.max)
    return { parameter, status: "FELETTE", value, range: band };
  return { parameter, status: "TARTOMANYBAN", value, range: band };
}

/** The deviation of every given value; the order of the input is kept. */
export function customerDeviations(
  measurements: ReadonlyArray<{
    parameter: string;
    value: number | null | undefined;
  }>,
  waterType: string | null | undefined,
  options: CustomerRangeOptions = {},
): CustomerDeviation[] {
  return measurements.map((entry) =>
    customerDeviation(entry.parameter, entry.value, waterType, options),
  );
}
