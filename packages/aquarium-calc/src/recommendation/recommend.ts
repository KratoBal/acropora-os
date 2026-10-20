import {
  DAILY_LIMITS,
  DEFAULT_EFFECT_HOURS,
  FUTURE_TOLERANCE_MS,
  HOUR_MS,
  MAX_DEVIATION_IN_BAND_WIDTHS,
  MAX_MEASUREMENT_AGE_DAYS,
  RECOMMENDATION_FRAME_VERSION,
  REPEAT_MEASUREMENT_WINDOW_HOURS,
  ROLLING_WINDOW_HOURS,
  dailyLimitFor,
  isRecommendationParameter,
  type DoseDirection,
  type RecommendationParameter,
} from "./frame.js";
import {
  DOSE_TEMPLATE_ID,
  doseSentence,
  noDoseSentence,
  noDoseTemplateId,
} from "./templates.js";
import type {
  DoseResult,
  DoseRow,
  MeasurementPoint,
  NoDoseReason,
  NoDoseResult,
  RecommendationInput,
  RecommendationLogEntry,
  RecommendationOptions,
  RecommendationResult,
  TargetBand,
} from "./types.js";

/**
 * THE AUTOMATIC RECOMMENDATION: THE CALCULATION AND THE SEVEN GATES (ReefClub
 * plan v6.1, 6.1 to 6.7; slice 8, first PR). A pure function: it answers ONE
 * parameter of ONE aquarium with either a dose (a product, an amount with its
 * unit, a duration and a source, in a fixed sentence) or the reason there is
 * none. It never writes text of its own and never reaches outside `input`.
 *
 * THE CALCULATION (6.1). Target = the middle of the band. Needed change = the
 * distance from the value to the target. Dose units = needed change times
 * (volume / 100) divided by what one unit changes in 100 litres, after the
 * change has been cut by the rest of the daily limit (and by what the
 * product's other parameters can take), and rounded DOWN to the dose step.
 *
 * THE ORDER OF THE REFUSALS is the order a customer should fix them in, and
 * the first one that applies is the one reported:
 *
 *    1  the parameter is outside the circle
 *    2  a valid proposal for it is already open
 *    3  no volume / no band / no measurement / a measurement dated in the
 *       future / a measurement too old                          (gate 1)
 *    4  the value is inside the band: nothing to do
 *    5  no automatic dose in that direction                     (gate 4)
 *    6  a dose is still working, or the measurement predates it (gate 1)
 *    7  the same measurement was already used a day ago         (6.5)
 *    8  an alarm-level manual measurement without a repeat      (gate 2)
 *    9  the deviation is more than twice the band's width       (gate 5)
 *   10  nitrate and phosphate together                          (6.7)
 *   11  an unknown-effect dose in the last 24 hours             (6.5)
 *   12  the limit is a placeholder / the day's limit is full    (6.5)
 *   13  no product can be used / the dose is above the maker's maximum or
 *       below its smallest step                                 (gates 6, 7)
 *
 * WHAT IS DECIDED HERE THAT THE PLAN LEAVES OPEN (each is a place to confirm):
 *  - a value inside the band gets no dose, even below the middle;
 *  - the deviation of gate 5 is measured from the target (the middle);
 *  - the nitrate-phosphate pairing is required for REDUCTIONS, as 6.7 words it;
 *  - one recommendation is ONE DAY's dose (`durationDays` 1): 6.5 forbids a
 *    new correction without a new measurement, so a multi-day course would
 *    ask for a second request the rules refuse;
 *  - among usable products the one that moves the fewest other parameters is
 *    taken, then the lowest product id;
 *  - a product that moves another parameter is usable only if that parameter
 *    has an approved limit, a fresh measurement and a band, and the change
 *    keeps it INSIDE its band; a product with no such room drops out.
 */

const TOLERANCE = 1e-9;

function sign(direction: DoseDirection): 1 | -1 {
  return direction === "EMEL" ? 1 : -1;
}

function usableBand(
  band: TargetBand | undefined,
): { min: number; max: number } | null {
  if (!band) return null;
  const { min, max } = band;
  if (min === undefined || max === undefined) return null;
  if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) return null;
  return { min, max };
}

function latestOf(
  measurements: readonly MeasurementPoint[],
  parameter: string,
): MeasurementPoint | null {
  let best: MeasurementPoint | null = null;
  for (const point of measurements) {
    if (point.parameter !== parameter || !Number.isFinite(point.value))
      continue;
    if (
      best === null ||
      point.measuredAt.getTime() > best.measuredAt.getTime() ||
      (point.measuredAt.getTime() === best.measuredAt.getTime() &&
        point.id > best.id)
    )
      best = point;
  }
  return best;
}

function liveRows(rows: readonly DoseRow[]): DoseRow[] {
  return rows.filter(
    (row) =>
      row.refusals.length === 0 &&
      Number.isFinite(row.effectPer100L) &&
      row.effectPer100L > 0 &&
      Number.isFinite(row.step) &&
      row.step > 0,
  );
}

export function recommend(
  input: RecommendationInput,
  options: RecommendationOptions = {},
): RecommendationResult {
  const { now } = input;
  const allowPlaceholders = options.allowPlaceholderLimits === true;
  const limits = options.limits ?? DAILY_LIMITS;
  const windowStart = new Date(now.getTime() - ROLLING_WINDOW_HOURS * HOUR_MS);

  function logEntry(
    outcome: "DOSE" | "NO_DOSE",
    reason: NoDoseReason | null,
    templateId: string,
    basis: MeasurementPoint | null,
    row: DoseRow | null,
    reserved: { parameter: string; change: number }[],
  ): RecommendationLogEntry {
    return {
      frameVersion: RECOMMENDATION_FRAME_VERSION,
      requestedAt: now,
      parameter: input.parameter,
      basisMeasurementId: basis?.id ?? null,
      outcome,
      reason,
      templateId,
      rowId: row?.rowId ?? null,
      rowVersion: row?.rowVersion ?? null,
      reservedChanges: reserved,
    };
  }

  function refuse(
    reason: NoDoseReason,
    basis: MeasurementPoint | null = null,
    extra: { activeRecommendationId?: string } = {},
  ): NoDoseResult {
    const templateId = noDoseTemplateId(reason);
    const maxAgeDays = isRecommendationParameter(input.parameter)
      ? MAX_MEASUREMENT_AGE_DAYS[input.parameter]
      : undefined;
    return {
      kind: "NO_DOSE",
      parameter: input.parameter,
      reason,
      text: noDoseSentence(reason, { parameter: input.parameter, maxAgeDays }),
      templateId,
      ...(extra.activeRecommendationId
        ? { activeRecommendationId: extra.activeRecommendationId }
        : {}),
      log: logEntry("NO_DOSE", reason, templateId, basis, null, []),
    };
  }

  // 1. the circle
  if (!isRecommendationParameter(input.parameter))
    return refuse("OUT_OF_CIRCLE");
  const parameter: RecommendationParameter = input.parameter;

  // 2. one valid proposal per parameter
  const open = input.priorRecommendations.find(
    (prior) =>
      prior.parameter === parameter &&
      prior.status === "OPEN" &&
      prior.effectEndsAt.getTime() > now.getTime(),
  );
  if (open)
    return refuse("ACTIVE_RECOMMENDATION", null, {
      activeRecommendationId: open.id,
    });

  // 3. what a dose needs to start from
  const volume = input.volumeLiters;
  if (volume === null || !Number.isFinite(volume) || volume <= 0)
    return refuse("NO_VOLUME");
  const volumeUnits = volume / 100;

  const band = usableBand(input.bands[parameter]);
  if (!band) return refuse("NO_TARGET_BAND");

  const measurement = latestOf(input.measurements, parameter);
  if (!measurement) return refuse("NO_MEASUREMENT");
  if (measurement.measuredAt.getTime() - now.getTime() > FUTURE_TOLERANCE_MS)
    return refuse("MEASUREMENT_IN_FUTURE", measurement);
  const maxAgeMs = MAX_MEASUREMENT_AGE_DAYS[parameter] * 24 * HOUR_MS;
  if (now.getTime() - measurement.measuredAt.getTime() > maxAgeMs)
    return refuse("MEASUREMENT_TOO_OLD", measurement);

  // 4. nothing to do inside the band; 5. the direction must be in the circle
  const value = measurement.value;
  let direction: DoseDirection;
  if (value < band.min) direction = "EMEL";
  else if (value > band.max) direction = "CSOKKENT";
  else return refuse("IN_RANGE", measurement);
  const limit = dailyLimitFor(parameter, direction, limits);
  if (!limit) return refuse("OUT_OF_CIRCLE", measurement);

  const rows = liveRows(input.rows);
  const rowFor = (productId: string | null, param: string) =>
    productId === null
      ? undefined
      : rows.find(
          (row) => row.productId === productId && row.parameter === param,
        );

  // 6. a dose still working, or a measurement older than the last dose
  const hoursOf = (row: DoseRow | undefined) =>
    row?.effectHours ?? DEFAULT_EFFECT_HOURS;
  let lastEffectEnd = 0;
  for (const prior of input.priorRecommendations) {
    if (prior.status === "NOT_GIVEN") continue;
    const touches =
      prior.parameter === parameter ||
      prior.changes.some((change) => change.parameter === parameter);
    if (touches)
      lastEffectEnd = Math.max(lastEffectEnd, prior.effectEndsAt.getTime());
  }
  for (const given of input.administrations) {
    const row = rowFor(given.productId, parameter);
    if (given.parameter !== parameter && !row) continue;
    lastEffectEnd = Math.max(
      lastEffectEnd,
      given.at.getTime() + hoursOf(row) * HOUR_MS,
    );
  }
  if (lastEffectEnd > measurement.measuredAt.getTime())
    return refuse("REMEASURE_AFTER_DOSE", measurement);

  // 7. the same measurement does not open a second correction a day later
  const reused = input.priorRecommendations.some(
    (prior) =>
      prior.parameter === parameter &&
      prior.basisMeasurementId === measurement.id &&
      prior.createdAt.getTime() <= windowStart.getTime(),
  );
  if (reused) return refuse("SAME_MEASUREMENT_USED", measurement);

  // 8. an alarm-level manual measurement needs a repeat or a shop measurement
  if (measurement.alert && measurement.source === "MANUAL") {
    const repeated = input.measurements.some(
      (other) =>
        other.id !== measurement.id &&
        other.parameter === parameter &&
        other.alert &&
        Math.abs(
          other.measuredAt.getTime() - measurement.measuredAt.getTime(),
        ) <=
          REPEAT_MEASUREMENT_WINDOW_HOURS * HOUR_MS,
    );
    if (!repeated) return refuse("NEEDS_REPEAT_MEASUREMENT", measurement);
  }

  // 9. the whole deviation, from the target
  const target = (band.min + band.max) / 2;
  const needed = Math.abs(target - value);
  if (needed > MAX_DEVIATION_IN_BAND_WIDTHS * (band.max - band.min) + TOLERANCE)
    return refuse("DEVIATION_TOO_LARGE", measurement);

  // 10. nitrate and phosphate: a reduction needs the other one, measured at the same visit and not below its band
  if (
    direction === "CSOKKENT" &&
    (parameter === "NITRAT" || parameter === "FOSZFAT")
  ) {
    const other = parameter === "NITRAT" ? "FOSZFAT" : "NITRAT";
    const otherBand = usableBand(input.bands[other]);
    const otherPoint = input.measurements.find(
      (point) =>
        point.parameter === other &&
        point.occasionId === measurement.occasionId &&
        Number.isFinite(point.value),
    );
    const otherAgeMs =
      MAX_MEASUREMENT_AGE_DAYS[other as RecommendationParameter] * 24 * HOUR_MS;
    if (
      !otherBand ||
      !otherPoint ||
      now.getTime() - otherPoint.measuredAt.getTime() > otherAgeMs ||
      otherPoint.value <= 0 ||
      otherPoint.value < otherBand.min
    )
      return refuse("NITRATE_PHOSPHATE_GUARD", measurement);
  }

  // 11. a dose of unknown effect in the last 24 hours on this parameter
  const unknown = input.administrations.some((given) => {
    if (given.parameter !== parameter) return false;
    if (given.at.getTime() < windowStart.getTime()) return false;
    const row = rowFor(given.productId, parameter);
    return (
      !row ||
      given.amount === null ||
      !(given.amount > 0) ||
      given.unit === null ||
      given.unit !== row.unit
    );
  });
  if (unknown) return refuse("UNKNOWN_EFFECT_DOSE", measurement);

  // 12. the limit: approved, and what is left of it in the rolling 24 hours
  const limitUsable = (param: string, dir: DoseDirection) => {
    const found = dailyLimitFor(param, dir, limits);
    return found && (found.approval === "JOVAHAGYVA" || allowPlaceholders)
      ? found
      : undefined;
  };

  function committed(param: string, dir: DoseDirection): number {
    let total = 0;
    for (const prior of input.priorRecommendations) {
      if (prior.createdAt.getTime() < windowStart.getTime()) continue;
      if (prior.status !== "OPEN" && prior.status !== "EXPIRED") continue;
      for (const change of prior.changes) {
        if (change.parameter !== param) continue;
        if (Math.sign(change.change) === sign(dir))
          total += Math.abs(change.change);
      }
    }
    for (const given of input.administrations) {
      if (given.at.getTime() < windowStart.getTime()) continue;
      if (given.amount === null || !(given.amount > 0)) continue;
      const row = rowFor(given.productId, param);
      if (!row || row.direction !== dir || given.unit !== row.unit) continue;
      total += (given.amount / volumeUnits) * row.effectPer100L;
    }
    return total;
  }

  if (!limitUsable(parameter, direction))
    return refuse("LIMIT_NOT_APPROVED", measurement);
  const remainingOwn = limit.maxChangePer24h - committed(parameter, direction);
  if (remainingOwn <= TOLERANCE)
    return refuse("DAILY_LIMIT_FILLED", measurement);

  // 13. the products
  const candidates = rows.filter(
    (row) => row.parameter === parameter && row.direction === direction,
  );
  const productIds = [
    ...new Set(candidates.map((row) => row.productId)),
  ].sort();
  if (productIds.length === 0) return refuse("NO_USABLE_PRODUCT", measurement);

  interface Viable {
    row: DoseRow;
    amount: number;
    sideCount: number;
    changes: { parameter: string; change: number }[];
    raisesKhAndCalcium: boolean;
  }
  const viable: Viable[] = [];
  let sawAboveMax = false;
  let sawBelowStep = false;

  for (const productId of productIds) {
    const own = candidates.find((row) => row.productId === productId)!;
    const productRows = rows.filter((row) => row.productId === productId);
    // two rows for the same parameter in opposite directions: not a product to dose from
    if (
      productRows.some(
        (row) => row.parameter === parameter && row.direction !== direction,
      )
    )
      continue;

    let units = Number.POSITIVE_INFINITY;
    let usable = true;
    let sideCount = 0;
    for (const row of productRows) {
      let allowed: number;
      if (row.parameter === parameter) {
        allowed = Math.min(remainingOwn, needed);
      } else {
        sideCount += 1;
        if (!isRecommendationParameter(row.parameter)) {
          usable = false;
          break;
        }
        const sideLimit = limitUsable(row.parameter, row.direction);
        const sideBand = usableBand(input.bands[row.parameter]);
        const sidePoint = latestOf(input.measurements, row.parameter);
        if (!sideLimit || !sideBand || !sidePoint) {
          usable = false;
          break;
        }
        const sideAge = now.getTime() - sidePoint.measuredAt.getTime();
        if (
          sideAge > MAX_MEASUREMENT_AGE_DAYS[row.parameter] * 24 * HOUR_MS ||
          sidePoint.measuredAt.getTime() - now.getTime() > FUTURE_TOLERANCE_MS
        ) {
          usable = false;
          break;
        }
        const room =
          sideLimit.maxChangePer24h - committed(row.parameter, row.direction);
        const headroom =
          row.direction === "EMEL"
            ? sideBand.max - sidePoint.value
            : sidePoint.value - sideBand.min;
        allowed = Math.min(room, headroom);
        if (allowed <= TOLERANCE) {
          usable = false;
          break;
        }
      }
      units = Math.min(units, (allowed * volumeUnits) / row.effectPer100L);
    }
    if (!usable || !Number.isFinite(units)) continue;

    const stepped = Math.floor(units / own.step + TOLERANCE) * own.step;
    if (!(stepped > 0)) {
      sawBelowStep = true;
      continue;
    }
    const per100 = stepped / volumeUnits;
    const givenPer100 =
      input.administrations
        .filter(
          (given) =>
            given.productId === productId &&
            given.at.getTime() >= windowStart.getTime() &&
            given.amount !== null &&
            given.unit === own.unit,
        )
        .reduce((sum, given) => sum + (given.amount ?? 0), 0) / volumeUnits;
    if (
      own.maxDailyDosePer100L === null ||
      per100 > own.maxDailyDosePer100L - givenPer100 + TOLERANCE
    ) {
      sawAboveMax = true;
      continue;
    }

    viable.push({
      row: own,
      amount: stepped,
      sideCount,
      changes: productRows.map((row) => ({
        parameter: row.parameter,
        change:
          sign(row.direction) * (stepped / volumeUnits) * row.effectPer100L,
      })),
      raisesKhAndCalcium:
        productRows.some(
          (row) => row.parameter === "KH" && row.direction === "EMEL",
        ) &&
        productRows.some(
          (row) => row.parameter === "KALCIUM" && row.direction === "EMEL",
        ),
    });
  }

  if (viable.length === 0)
    return refuse(
      sawAboveMax
        ? "DOSE_ABOVE_MANUFACTURER_MAX"
        : sawBelowStep
          ? "DOSE_BELOW_STEP"
          : "NO_USABLE_PRODUCT",
      measurement,
    );

  viable.sort(
    (a, b) =>
      a.sideCount - b.sideCount ||
      (a.row.productId < b.row.productId
        ? -1
        : a.row.productId > b.row.productId
          ? 1
          : 0),
  );
  const chosen = viable[0]!;

  const durationDays = 1;
  const effectHours = chosen.row.effectHours ?? DEFAULT_EFFECT_HOURS;
  const text = doseSentence({
    parameter,
    direction,
    amount: chosen.amount,
    unit: chosen.row.unit,
    productName: chosen.row.productName,
    durationDays,
    source: chosen.row.source,
    effectHours,
    raisesKhAndCalcium: chosen.raisesKhAndCalcium,
  });
  if (text === null) return refuse("INCOMPLETE_DOSE_TEMPLATE", measurement);

  const result: DoseResult = {
    kind: "DOSE",
    parameter,
    direction,
    product: {
      rowId: chosen.row.rowId,
      rowVersion: chosen.row.rowVersion,
      productId: chosen.row.productId,
      productName: chosen.row.productName,
    },
    amount: chosen.amount,
    unit: chosen.row.unit,
    durationDays,
    source: chosen.row.source,
    effectHours,
    basisMeasurementId: measurement.id,
    text,
    templateId: DOSE_TEMPLATE_ID,
    log: logEntry(
      "DOSE",
      null,
      DOSE_TEMPLATE_ID,
      measurement,
      chosen.row,
      chosen.changes,
    ),
  };
  return result;
}
