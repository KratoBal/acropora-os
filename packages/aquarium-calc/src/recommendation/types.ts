import type {
  DailyLimit,
  DoseDirection,
  DoseUnit,
  RecommendationParameter,
} from "./frame.js";

/**
 * THE INPUTS AND OUTPUTS OF THE AUTOMATIC RECOMMENDATION (ReefClub plan v6.1,
 * 6; slice 8, first PR). Plain data in, a verdict out: no database, no
 * session, no clock but `now`. The service that reads the rows and writes the
 * log comes in a later PR; it fills these shapes.
 */

export interface TargetBand {
  min?: number;
  max?: number;
}

/** One measured value. `occasionId` ties the values of one visit together (plan 6.7). */
export interface MeasurementPoint {
  id: string;
  occasionId: string;
  parameter: string;
  value: number;
  measuredAt: Date;
  /** A shop measurement settles an alarm without a repeat (plan 6.3 gate 2). */
  source: "MANUAL" | "SHOP";
  /**
   * Whether the value is ALERT against the aquarium's band for that
   * parameter, as `measurementStatus` (packages/types, D1) says. The caller
   * computes it with the same band it passes in `bands`: one definition of
   * "alarm", not two.
   */
  alert: boolean;
}

/**
 * ONE ROW OF THE PRODUCT-DOSE LIST (slice 7): one product, one parameter, one
 * direction. `refusals` is the output of `doseEffectRefusals` (apps/api);
 * only a row with NO refusal is used, whatever else it says.
 */
export interface DoseRow {
  rowId: string;
  rowVersion: number;
  productId: string;
  productName: string;
  parameter: string;
  direction: DoseDirection;
  /** What ONE dose unit changes the parameter by in 100 litres, in the parameter's own unit. */
  effectPer100L: number;
  unit: DoseUnit;
  /** The smallest dose step, in the dose unit. */
  step: number;
  /** The manufacturer's daily maximum for 100 litres, in the dose unit. */
  maxDailyDosePer100L: number | null;
  effectHours: number | null;
  source: string;
  refusals: readonly string[];
  /**
   * Whether the shop has the product in stock; null or missing: not known.
   * Used only to choose between products that would do equally well.
   */
  inStock?: boolean | null;
  /**
   * The price of ONE dose unit (in `unit`), in forint; null or missing: not
   * known. Used only to choose between products that would do equally well.
   */
  pricePerDoseUnit?: number | null;
}

/**
 * A DOSE THE CUSTOMER RECORDED AS GIVEN (plan 6.5: its own field, apart from
 * the recommended one). `parameter` is what it was meant for. `productId`
 * null is "another product": its effect is unknown.
 */
export interface AdministrationRecord {
  id: string;
  at: Date;
  parameter: string;
  productId: string | null;
  amount: number | null;
  unit: DoseUnit | null;
}

export type PriorRecommendationStatus =
  "OPEN" | "GIVEN" | "PARTIAL" | "NOT_GIVEN" | "EXPIRED";

/**
 * AN EARLIER RECOMMENDATION FROM THE LOG. Its `changes` are what it reserved
 * (signed, per parameter). An OPEN or EXPIRED one is counted as GIVEN in the
 * limit (plan 6.5, v5: the safe side); a GIVEN or PARTIAL one is represented
 * by the administration the customer recorded, and a NOT_GIVEN one by nothing.
 */
export interface PriorRecommendation {
  id: string;
  createdAt: Date;
  parameter: string;
  basisMeasurementId: string;
  /**
   * What it recommended: the product and the amount in the row's unit. The
   * manufacturer's daily maximum counts an open or expired recommendation as
   * given, so the log keeps these three with it. `productId` is null when
   * the product has since been deleted (the log's foreign key is set null):
   * to the calculation that is "another product", an unknown effect.
   */
  productId: string | null;
  amount: number;
  unit: DoseUnit;
  status: PriorRecommendationStatus;
  /** When its effect time ends; an OPEN one before this is the one valid proposal. */
  effectEndsAt: Date;
  changes: readonly { parameter: string; change: number }[];
}

export interface RecommendationInput {
  now: Date;
  parameter: string;
  /** Net volume in litres; null: not given. */
  volumeLiters: number | null;
  /** The effective target band per parameter (own, else the catalogue's). */
  bands: Readonly<Record<string, TargetBand | undefined>>;
  measurements: readonly MeasurementPoint[];
  rows: readonly DoseRow[];
  administrations: readonly AdministrationRecord[];
  priorRecommendations: readonly PriorRecommendation[];
  /**
   * When the rows above were last built successfully (the projection's last
   * SUCCEEDED run); null: never. A list built longer ago than
   * `MAX_DOSE_LIST_AGE_HOURS` gives no dose.
   */
  doseListBuiltAt: Date | null;
}

export interface RecommendationOptions {
  /** Tests only: use a limit marked HELYORZO. Never set it in production code. */
  allowPlaceholderLimits?: boolean;
  /** Tests only: another limit list than the frame's `DAILY_LIMITS`. */
  limits?: readonly DailyLimit[];
}

/** Why there is no dose; each has a fixed sentence (templates.ts). */
export type NoDoseReason =
  | "OUT_OF_CIRCLE"
  | "ACTIVE_RECOMMENDATION"
  | "DOSE_LIST_STALE"
  | "NO_VOLUME"
  | "NO_TARGET_BAND"
  | "NO_MEASUREMENT"
  | "MEASUREMENT_IN_FUTURE"
  | "MEASUREMENT_TOO_OLD"
  | "REMEASURE_AFTER_DOSE"
  | "SAME_MEASUREMENT_USED"
  | "NEEDS_REPEAT_MEASUREMENT"
  | "IN_RANGE"
  | "DEVIATION_TOO_LARGE"
  | "NITRATE_PHOSPHATE_GUARD"
  | "UNKNOWN_EFFECT_DOSE"
  | "LIMIT_NOT_APPROVED"
  | "DAILY_LIMIT_FILLED"
  | "NO_USABLE_PRODUCT"
  | "DOSE_ABOVE_MANUFACTURER_MAX"
  | "DOSE_BELOW_STEP"
  | "INCOMPLETE_DOSE_TEMPLATE";

/** What the log keeps of one request (plan 6.1): enough to see afterwards what was given and why. */
export interface RecommendationLogEntry {
  frameVersion: string;
  requestedAt: Date;
  parameter: string;
  basisMeasurementId: string | null;
  outcome: "DOSE" | "NO_DOSE";
  reason: NoDoseReason | null;
  templateId: string;
  rowId: string | null;
  rowVersion: number | null;
  /** What this recommendation reserves, signed per parameter; empty without a dose. */
  reservedChanges: readonly { parameter: string; change: number }[];
}

export interface DoseResult {
  kind: "DOSE";
  parameter: RecommendationParameter;
  direction: DoseDirection;
  product: {
    rowId: string;
    rowVersion: number;
    productId: string;
    productName: string;
  };
  amount: number;
  unit: DoseUnit;
  /** Days the dose is given. The engine gives one day at a time: a new correction needs a new measurement. */
  durationDays: number;
  source: string;
  effectHours: number;
  basisMeasurementId: string;
  text: string;
  templateId: string;
  log: RecommendationLogEntry;
}

export interface NoDoseResult {
  kind: "NO_DOSE";
  parameter: string;
  reason: NoDoseReason;
  text: string;
  templateId: string;
  /** For ACTIVE_RECOMMENDATION: the proposal the customer sees again. */
  activeRecommendationId?: string;
  log: RecommendationLogEntry;
}

export type RecommendationResult = DoseResult | NoDoseResult;
