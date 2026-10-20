/**
 * THE FRAME OF THE AUTOMATIC RECOMMENDATION (ReefClub plan v6.1, 6.3 and 6.5;
 * slice 8): which parameters and directions it handles, the daily limits, and
 * how old a measurement may be. One object with a VERSION, because every
 * logged recommendation names the frame it was computed under (plan 6.1).
 *
 * WHAT IS APPROVED AND WHAT IS NOT, marked on each entry:
 *
 *   JOVAHAGYVA  Balázs approved the number (plan 6.5, 11:36:53 UTC): the
 *               three limits KH 1 dKH, calcium 20 mg/l, magnesium 100 mg/l.
 *   HELYORZO    a PLACEHOLDER, not a professional number. The plan's nitrate
 *               and phosphate limits are "javaslat [N], szakmai jóváhagyásra"
 *               (never measured), and acrobot asked for a marked placeholder
 *               in their place. The engine REFUSES to give a dose from a
 *               placeholder limit unless the caller says so explicitly
 *               (`allowPlaceholderLimits`, meant for tests only): a parameter
 *               whose limit is not approved has no automatic dose.
 *
 * The data ages (plan 6.3 gate 1) are a proposal for professional approval
 * too, but they only make the engine stricter, so they apply as they stand.
 */
export const RECOMMENDATION_FRAME_VERSION = "keret-2026-10-20-v0";

/** The parameters the automatic dose covers (plan 6.3 gate 4). */
export const RECOMMENDATION_PARAMETERS = [
  "KH",
  "KALCIUM",
  "MAGNEZIUM",
  "NITRAT",
  "FOSZFAT",
] as const;
export type RecommendationParameter =
  (typeof RECOMMENDATION_PARAMETERS)[number];

export type DoseDirection = "EMEL" | "CSOKKENT";
export type DoseUnit = "ML" | "G" | "CSEPP";

export type LimitApproval = "JOVAHAGYVA" | "HELYORZO";

export interface DailyLimit {
  parameter: RecommendationParameter;
  direction: DoseDirection;
  /** The largest change in the parameter's own unit over a rolling 24 hours. */
  maxChangePer24h: number;
  approval: LimitApproval;
}

/**
 * The plan's list (6.5). KH, magnesium and calcium are only RAISED; nitrate
 * and phosphate both ways. Anything not here has no limit, so no dose.
 */
export const DAILY_LIMITS: readonly DailyLimit[] = [
  {
    parameter: "KH",
    direction: "EMEL",
    maxChangePer24h: 1,
    approval: "JOVAHAGYVA",
  },
  {
    parameter: "KALCIUM",
    direction: "EMEL",
    maxChangePer24h: 20,
    approval: "JOVAHAGYVA",
  },
  {
    parameter: "MAGNEZIUM",
    direction: "EMEL",
    maxChangePer24h: 100,
    approval: "JOVAHAGYVA",
  },
  {
    parameter: "NITRAT",
    direction: "CSOKKENT",
    maxChangePer24h: 5,
    approval: "HELYORZO",
  },
  {
    parameter: "NITRAT",
    direction: "EMEL",
    maxChangePer24h: 2,
    approval: "HELYORZO",
  },
  {
    parameter: "FOSZFAT",
    direction: "CSOKKENT",
    maxChangePer24h: 0.03,
    approval: "HELYORZO",
  },
  {
    parameter: "FOSZFAT",
    direction: "EMEL",
    maxChangePer24h: 0.02,
    approval: "HELYORZO",
  },
];

/** Plan 6.3 gate 1: KH and calcium 3 days, the others 7 (a proposal). */
export const MAX_MEASUREMENT_AGE_DAYS: Record<RecommendationParameter, number> =
  {
    KH: 3,
    KALCIUM: 3,
    MAGNEZIUM: 7,
    NITRAT: 7,
    FOSZFAT: 7,
  };

export const HOUR_MS = 60 * 60 * 1000;
/** The limit and the "one correction per measurement" rule use a ROLLING window (plan 6.5, v5). */
export const ROLLING_WINDOW_HOURS = 24;
/** An alarm-level manual measurement needs a repeat within this long (plan 6.3 gate 2). */
export const REPEAT_MEASUREMENT_WINDOW_HOURS = 48;
/** A product row without an effect time works for this long (plan 6.2, v6). */
export const DEFAULT_EFFECT_HOURS = 24;
/** A total deviation above this many band widths gets no dose (plan 6.3 gate 5). */
export const MAX_DEVIATION_IN_BAND_WIDTHS = 2;
/** A measurement dated further ahead than this is a typo, not a measurement. */
export const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

export function dailyLimitFor(
  parameter: string,
  direction: DoseDirection,
): DailyLimit | undefined {
  return DAILY_LIMITS.find(
    (limit) => limit.parameter === parameter && limit.direction === direction,
  );
}

export function isRecommendationParameter(
  parameter: string,
): parameter is RecommendationParameter {
  return (RECOMMENDATION_PARAMETERS as readonly string[]).includes(parameter);
}
