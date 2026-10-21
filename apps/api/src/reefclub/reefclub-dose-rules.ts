import {
  FUTURE_TOLERANCE_MS,
  RECOMMENDATION_PARAMETERS,
  dailyLimitFor,
} from "@acropora/aquarium-calc";

/**
 * How far back a dose may be dated: the longest age a measurement may have
 * (seven days, plan 6.3). Older is refused (barracuda, endpoints): an entry
 * that far back could only fill in a history, and the limit's 24 hour window
 * would not count it anyway.
 */
export const DOSE_MAX_AGE_DAYS = 7;

/**
 * WHAT THE CUSTOMER MAY RECORD AS GIVEN (ReefClub plan v6.1, 6.5; slice 8,
 * the dose PR). The pure rules: no database, so every refusal is tested
 * without one. The recorded dose is a fact of the customer's, KEPT APART from
 * the recommended amount, and the daily limit counts what is recorded here.
 * That makes the entry a thing to guard from both sides:
 *
 *  - NOT IN THE FUTURE and NOT OLDER THAN SEVEN DAYS (barracuda, #1753 and
 *    the endpoints): a dose dated further ahead than the clock's tolerance
 *    would hold the next recommendation back for good, and a dose dated long
 *    ago can only fill in a history (the limit counts the last 24 hours, the
 *    effect time reaches back further);
 *  - A DOSE OF A LISTED PRODUCT CARRIES ITS AMOUNT AND UNIT, or neither: a
 *    half-known dose is an "unknown effect" and stops the parameter, which is
 *    the customer's to choose ("another product"), not a form accident;
 *  - ZERO IS NOT A DOSE: a recorded 0 would count as nothing given and open a
 *    new full correction; "I did not give it" is the not-given answer;
 *  - A DOSE THAT NAMES A RECOMMENDATION is of its parameter and product, in its
 *    unit, not before it was issued, and the recommendation is still open;
 *  - A DIFFERENT AMOUNT THAN RECOMMENDED needs a confirmation (plan 6.5), so a
 *    mistyped number is seen before it is counted;
 *  - A DOSE OVER THE MAKER'S MAXIMUM OR THE DAILY LIMIT IS RECORDED (it is the
 *    customer's fact) with a warning; the limit then counts it and no more is
 *    recommended for that parameter.
 */
export type DoseUnit = "ML" | "G" | "CSEPP";

export interface DoseEntry {
  parameter: string;
  /** Null: "another product" (unknown effect). */
  productId: string | null;
  amount: number | null;
  unit: DoseUnit | null;
  administeredAt: Date;
  recommendationId: string | null;
  /** The customer saw that the amount differs from the recommended one. */
  confirmed: boolean;
}

export interface LinkedRecommendation {
  id: string;
  parameterCode: string;
  productId: string | null;
  amount: number;
  unit: DoseUnit;
  createdAt: Date;
  status: "OPEN" | "GIVEN" | "PARTIAL" | "NOT_GIVEN";
}

/** The projected row of the dose's product for its parameter, if the list has one. */
export interface DoseRowFacts {
  direction: "EMEL" | "CSOKKENT";
  effectPer100L: number;
  maxDailyDosePer100L: number | null;
}

export interface DoseContext {
  now: Date;
  volumeLiters: number | null;
  /** The products the dose list knows (any row, live or not). */
  knownProductIds: ReadonlySet<string>;
  row: DoseRowFacts | null;
  recommendation: LinkedRecommendation | null;
  /**
   * The dose answers a recommendation with "partly": at most the recommended
   * amount (barracuda, endpoints): more is not "partly", it is a plain dose,
   * recorded apart from the recommendation.
   */
  partial?: boolean;
}

export type DoseRefusalCode =
  | "INVALID_PARAMETER"
  | "TIME_IN_FUTURE"
  | "TIME_TOO_OLD"
  | "AMOUNT_UNIT_INCOMPLETE"
  | "AMOUNT_NOT_POSITIVE"
  | "UNKNOWN_PRODUCT"
  | "RECOMMENDATION_NOT_OPEN"
  | "RECOMMENDATION_OTHER_PARAMETER"
  | "RECOMMENDATION_OTHER_PRODUCT"
  | "RECOMMENDATION_OTHER_UNIT"
  | "PARTIAL_ABOVE_RECOMMENDED"
  | "BEFORE_RECOMMENDATION";

export type DoseWarningCode = "ABOVE_MAKER_MAX" | "ABOVE_DAILY_LIMIT";

export type DoseCheck =
  | { kind: "REFUSED"; code: DoseRefusalCode; message: string }
  | {
      kind: "NEEDS_CONFIRMATION";
      message: string;
      recommendedAmount: number;
    }
  | {
      kind: "OK";
      warnings: { code: DoseWarningCode; message: string }[];
    };

const MESSAGES: Record<DoseRefusalCode, string> = {
  INVALID_PARAMETER: "Ehhez a paraméterhez nem rögzíthető adag.",
  TIME_IN_FUTURE: "A beadás időpontja a jövőben van; javítsd az időpontot.",
  TIME_TOO_OLD:
    "A beadás időpontja legfeljebb 7 nappal lehet korábbi; régebbi adagot nem rögzítünk.",
  AMOUNT_UNIT_INCOMPLETE:
    "A mennyiséget és a mértékegységet együtt add meg, vagy egyiket se; ha nem tudod, jelöld meg, hogy más terméket adtál be.",
  AMOUNT_NOT_POSITIVE:
    "A beadott mennyiség nulla vagy kisebb nem lehet; ha nem adtad be, jelezd, hogy nem adtad be.",
  UNKNOWN_PRODUCT:
    "Ez a termék nincs a termék-adag listán; jelöld meg, hogy más terméket adtál be.",
  RECOMMENDATION_NOT_OPEN: "Erre az ajánlásra már jelezted a beadást.",
  RECOMMENDATION_OTHER_PARAMETER:
    "Ez az ajánlás másik paraméterre szól, mint a rögzítendő adag.",
  RECOMMENDATION_OTHER_PRODUCT:
    "Az ajánláshoz az ajánlott termék adagját rögzítheted; más terméket külön, ajánlás nélkül rögzíts.",
  RECOMMENDATION_OTHER_UNIT:
    "Az ajánláshoz az ajánlott mértékegységben rögzíthetsz adagot.",
  PARTIAL_ABOVE_RECOMMENDED:
    "Részleges beadásnál legfeljebb az ajánlott mennyiséget adhatod meg; ha többet adtál be, rögzítsd külön adagként, ajánlás nélkül.",
  BEFORE_RECOMMENDATION:
    "A beadás időpontja az ajánlás kiadása előtti; az ajánláshoz nem rögzíthető.",
};

function refused(code: DoseRefusalCode): DoseCheck {
  return { kind: "REFUSED", code, message: MESSAGES[code] };
}

export function checkDoseEntry(
  entry: DoseEntry,
  context: DoseContext,
): DoseCheck {
  const { now } = context;
  if (
    !(RECOMMENDATION_PARAMETERS as readonly string[]).includes(entry.parameter)
  )
    return refused("INVALID_PARAMETER");

  const at = entry.administeredAt.getTime();
  if (!Number.isFinite(at)) return refused("TIME_IN_FUTURE");
  if (at - now.getTime() > FUTURE_TOLERANCE_MS)
    return refused("TIME_IN_FUTURE");
  if (now.getTime() - at > DOSE_MAX_AGE_DAYS * 24 * 3_600_000)
    return refused("TIME_TOO_OLD");

  if ((entry.amount === null) !== (entry.unit === null))
    return refused("AMOUNT_UNIT_INCOMPLETE");
  if (
    entry.amount !== null &&
    !(Number.isFinite(entry.amount) && entry.amount > 0)
  )
    return refused("AMOUNT_NOT_POSITIVE");

  if (entry.productId !== null && !context.knownProductIds.has(entry.productId))
    return refused("UNKNOWN_PRODUCT");

  const recommendation = context.recommendation;
  if (entry.recommendationId !== null) {
    if (!recommendation || recommendation.id !== entry.recommendationId)
      return refused("RECOMMENDATION_NOT_OPEN");
    if (recommendation.status !== "OPEN")
      return refused("RECOMMENDATION_NOT_OPEN");
    if (recommendation.parameterCode !== entry.parameter)
      return refused("RECOMMENDATION_OTHER_PARAMETER");
    if (
      entry.productId !== recommendation.productId ||
      entry.productId === null
    )
      return refused("RECOMMENDATION_OTHER_PRODUCT");
    if (entry.unit !== null && entry.unit !== recommendation.unit)
      return refused("RECOMMENDATION_OTHER_UNIT");
    if (at < recommendation.createdAt.getTime() - FUTURE_TOLERANCE_MS)
      return refused("BEFORE_RECOMMENDATION");
    if (
      context.partial &&
      entry.amount !== null &&
      entry.amount > recommendation.amount
    )
      return refused("PARTIAL_ABOVE_RECOMMENDED");
    if (
      entry.amount !== null &&
      entry.amount !== recommendation.amount &&
      !entry.confirmed
    )
      return {
        kind: "NEEDS_CONFIRMATION",
        recommendedAmount: recommendation.amount,
        message:
          "A beadott mennyiség eltér az ajánlottól; erősítsd meg, hogy ezt adtad be.",
      };
  }

  const warnings: { code: DoseWarningCode; message: string }[] = [];
  if (
    entry.amount !== null &&
    context.row &&
    context.volumeLiters !== null &&
    context.volumeLiters > 0
  ) {
    const per100 = entry.amount / (context.volumeLiters / 100);
    if (
      context.row.maxDailyDosePer100L !== null &&
      per100 > context.row.maxDailyDosePer100L
    )
      warnings.push({
        code: "ABOVE_MAKER_MAX",
        message:
          "Ez több, mint a gyártó napi legnagyobb adagja; rögzítettük, de erre a paraméterre most nem ajánlunk többet.",
      });
    const limit = dailyLimitFor(entry.parameter, context.row.direction);
    if (limit && per100 * context.row.effectPer100L > limit.maxChangePer24h)
      warnings.push({
        code: "ABOVE_DAILY_LIMIT",
        message:
          "Ez a napi korlátnál nagyobb változást adna; rögzítettük, de erre a paraméterre most nem ajánlunk többet.",
      });
  }
  return { kind: "OK", warnings };
}
