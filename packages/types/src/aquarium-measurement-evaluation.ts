/**
 * THE EVALUATION OF ONE MEASURED VALUE AGAINST ITS TARGET RANGE, IN ONE PLACE
 * (ReefClub plan v6.1, point 9, slice 1). Moved here unchanged from
 * `apps/api/src/aquariums/measurement-report.ts` so the OS API, the OS web,
 * the partner portal and later the ReefClub compute the same thing. It has no
 * dependency on a session, a request or a database: plain numbers in, a
 * verdict out.
 *
 * The rules, decided 2026-10-08 (acrobot 28275, plan
 * `megosztas/meresi-pdf-terv-2026-10-08.md`):
 *
 *   D1  inside the target range: OK; outside by less than the range's width:
 *       WARN; by the width or more: ALERT. A one-sided range (only a minimum
 *       or only a maximum) uses 10% of that bound as the width.
 *   D2  the trend compares the distance from the range with the previous
 *       measurement of the same parameter: closer is IMPROVING, farther is
 *       WORSENING, both inside or the same distance is STABLE.
 *
 * The range itself comes from `aquariumEffectiveMeasurementTargetRange`.
 */

export type MeasurementStatus = "OK" | "WARN" | "ALERT";
export type MeasurementTrend = "IMPROVING" | "WORSENING" | "STABLE";

export interface MeasurementRange {
  min?: number;
  max?: number;
}

/** How far a value lies outside a range, and on which side; 0 inside. */
export function measurementDistanceFromRange(
  value: number,
  range: MeasurementRange,
): { distance: number; direction: "LOW" | "HIGH" | null } {
  if (range.min !== undefined && value < range.min)
    return { distance: range.min - value, direction: "LOW" };
  if (range.max !== undefined && value > range.max)
    return { distance: value - range.max, direction: "HIGH" };
  return { distance: 0, direction: null };
}

/**
 * THE PLAIN IN/OUT CHECK THE SCREENS DRAW (the warning tile, the red dot, the
 * marked table cell): strictly below the minimum or strictly above the
 * maximum, with NO tolerance. It is not `measurementStatus(...) !== "OK"`:
 * that one treats a value within 1e-9 of a bound as inside. The screens
 * never did, and this slice must not change what they show. No range: never
 * outside.
 */
export function isOutsideMeasurementRange(
  value: number,
  range: MeasurementRange | undefined,
): boolean {
  if (range === undefined) return false;
  return measurementDistanceFromRange(value, range).direction !== null;
}

/**
 * THE TOLERANCE OF A COMPARISON (barracuda's review, #1640): the distance and
 * the width are float differences, so on a range of 7,8–8,4 a value of 7,2
 * gives 0.5999999999999996 against 0.6000000000000005, and "exactly the width"
 * would fall on the warning side. Equal within this tolerance counts as equal.
 */
const TOLERANCE = 1e-9;

/** D1. */
export function measurementStatus(
  value: number,
  range: MeasurementRange,
): MeasurementStatus {
  const { distance } = measurementDistanceFromRange(value, range);
  if (distance <= TOLERANCE) return "OK";
  // A ONE-SIDED BOUND OF 0 (for example "max. 0") has a width of 0: any
  // deviation from it needs action. That is intended, not an edge case.
  const width =
    range.min !== undefined && range.max !== undefined
      ? range.max - range.min
      : Math.abs((range.min ?? range.max)!) * 0.1;
  return distance < width - TOLERANCE ? "WARN" : "ALERT";
}

/** D2. */
export function measurementTrend(
  value: number,
  previous: number | undefined,
  range: MeasurementRange,
): MeasurementTrend | null {
  if (previous === undefined) return null;
  const now = measurementDistanceFromRange(value, range).distance;
  const before = measurementDistanceFromRange(previous, range).distance;
  if (now < before - TOLERANCE) return "IMPROVING";
  if (now > before + TOLERANCE) return "WORSENING";
  return "STABLE";
}
