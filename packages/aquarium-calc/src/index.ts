export {
  alkalinityElevation,
  calciumElevation,
  magnesiumElevation,
} from "./reef-chemistry.js";
export type {
  AlkalinityElevationInput,
  ConcentrationElevationInput,
  MagnesiumSalt,
  ReefChemistryElevationResult,
} from "./reef-chemistry.js";
export {
  DAILY_LIMITS,
  DEFAULT_EFFECT_HOURS,
  FUTURE_TOLERANCE_MS,
  ROLLING_WINDOW_HOURS,
  MAX_MEASUREMENT_AGE_DAYS,
  RECOMMENDATION_FRAME_VERSION,
  RECOMMENDATION_PARAMETERS,
  dailyLimitFor,
  huNumber,
  recommend,
} from "./recommendation/index.js";
export type {
  AdministrationRecord,
  DailyLimit,
  DoseDirection,
  DoseResult,
  DoseRow,
  DoseUnit,
  LimitApproval,
  MeasurementPoint,
  NoDoseReason,
  NoDoseResult,
  PriorRecommendation,
  PriorRecommendationStatus,
  RecommendationInput,
  RecommendationLogEntry,
  RecommendationOptions,
  RecommendationParameter,
  RecommendationResult,
  TargetBand,
} from "./recommendation/index.js";
