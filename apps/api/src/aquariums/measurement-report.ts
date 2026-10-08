import {
  aquariumEffectiveMeasurementTargetRange,
  aquariumMeasurementParameter,
  type AquariumMeasurementOccasion,
  type AquariumMeasurementParameterCode,
  type AquariumMeasurementTarget,
  type WaterType,
} from "@acropora/types";

/**
 * THE MEASUREMENT REPORT, AS DATA (card 77767969; Figma FwfCAidFkuS7WVcGa2hWTN,
 * 06 · Mérési eredmények és ICP elemzés). The rules, decided 2026-10-08
 * (acrobot 28275, plan `megosztas/meresi-pdf-terv-2026-10-08.md`):
 *
 *   D1  inside the target range: OK; outside by less than the range's width:
 *       WARN; by the width or more: ALERT. A one-sided range (only a minimum
 *       or only a maximum) uses 10% of that bound as the width.
 *   D2  the trend compares the distance from the range with the previous
 *       measurement of the same parameter: closer is IMPROVING, farther is
 *       WORSENING, both inside or the same distance is STABLE.
 *   D5  no range (a freshwater aquarium without its own target): no mark.
 *
 * The range itself comes from the one place every deviation uses
 * (`aquariumEffectiveMeasurementTargetRange`: the aquarium's own target, else
 * the marine default).
 */

export type ReportStatus = "OK" | "WARN" | "ALERT";
export type ReportTrend = "IMPROVING" | "WORSENING" | "STABLE";

export interface ReportRange {
  min?: number;
  max?: number;
}

export interface ReportRow {
  label: string;
  measured: string;
  previous: string | null;
  target: string | null;
  status: ReportStatus | null;
  direction: "LOW" | "HIGH" | null;
  trend: ReportTrend | null;
}

/** How far a value lies outside a range, and on which side; 0 inside. */
export function distanceFromRange(
  value: number,
  range: ReportRange,
): { distance: number; direction: "LOW" | "HIGH" | null } {
  if (range.min !== undefined && value < range.min)
    return { distance: range.min - value, direction: "LOW" };
  if (range.max !== undefined && value > range.max)
    return { distance: value - range.max, direction: "HIGH" };
  return { distance: 0, direction: null };
}

/** D1. */
/**
 * THE TOLERANCE OF A COMPARISON (barracuda's review, #1640): the distance and
 * the width are float differences, so on a range of 7,8–8,4 a value of 7,2
 * gives 0.5999999999999996 against 0.6000000000000005, and "exactly the width"
 * would fall on the warning side. Equal within this tolerance counts as equal.
 */
const TOLERANCE = 1e-9;

export function reportStatus(value: number, range: ReportRange): ReportStatus {
  const { distance } = distanceFromRange(value, range);
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
export function reportTrend(
  value: number,
  previous: number | undefined,
  range: ReportRange,
): ReportTrend | null {
  if (previous === undefined) return null;
  const now = distanceFromRange(value, range).distance;
  const before = distanceFromRange(previous, range).distance;
  if (now < before - TOLERANCE) return "IMPROVING";
  if (now > before + TOLERANCE) return "WORSENING";
  return "STABLE";
}

/** Hungarian decimals: a comma, and the number as it was measured. */
export function formatReportNumber(value: number): string {
  return String(value).replace(".", ",");
}

export function formatReportRange(
  range: ReportRange,
  unit: string,
): string | null {
  const u = unit ? ` ${unit}` : "";
  if (range.min !== undefined && range.max !== undefined)
    return `${formatReportNumber(range.min)}–${formatReportNumber(range.max)}${u}`;
  // "min." and "max." in words: Noto Sans has no ≥ and ≤ (measured 2026-10-08)
  if (range.min !== undefined)
    return `min. ${formatReportNumber(range.min)}${u}`;
  if (range.max !== undefined)
    return `max. ${formatReportNumber(range.max)}${u}`;
  return null;
}

/**
 * The previous value of each parameter: from the latest occasion before this
 * one that measured it (D2). `occasions` in any order.
 */
export function previousValues(
  occasions: readonly AquariumMeasurementOccasion[],
  current: AquariumMeasurementOccasion,
): Map<string, number> {
  const before = occasions
    .filter((o) => o.measuredAt < current.measuredAt)
    .sort((a, b) => b.measuredAt.localeCompare(a.measuredAt));
  const out = new Map<string, number>();
  for (const occasion of before)
    for (const v of occasion.values)
      if (!out.has(v.parameterCode)) out.set(v.parameterCode, v.value);
  return out;
}

export function measuredRows(
  occasion: AquariumMeasurementOccasion,
  previous: ReadonlyMap<string, number>,
  waterType: WaterType | null | undefined,
  targets: readonly AquariumMeasurementTarget[],
): ReportRow[] {
  return occasion.values.map((v) => {
    const definition = aquariumMeasurementParameter(v.parameterCode);
    // the pH "unit" is the parameter's own name: it is not written after it
    const unit = definition?.unit === "pH" ? "" : (definition?.unit ?? "");
    const range = aquariumEffectiveMeasurementTargetRange(
      waterType,
      v.parameterCode as AquariumMeasurementParameterCode,
      targets,
    );
    const before = previous.get(v.parameterCode);
    const hasRange =
      range !== undefined &&
      (range.min !== undefined || range.max !== undefined);
    return {
      label: definition?.label ?? v.parameterCode,
      measured: `${formatReportNumber(v.value)}${unit ? ` ${unit}` : ""}`,
      previous:
        before === undefined
          ? null
          : `${formatReportNumber(before)}${unit ? ` ${unit}` : ""}`,
      target: hasRange ? formatReportRange(range!, unit) : null,
      status: hasRange ? reportStatus(v.value, range!) : null,
      direction: hasRange ? distanceFromRange(v.value, range!).direction : null,
      trend: hasRange ? reportTrend(v.value, before, range!) : null,
    };
  });
}

export interface IcpReportRowInput {
  elementCode: string;
  value: number;
  unit: string;
  minimum: number | null;
  maximum: number | null;
  trend: string | null;
}

/** ICP rows: the laboratory's own range and trend (D3 picks the report). */
export function icpRows(results: readonly IcpReportRowInput[]): ReportRow[] {
  return results.map((r) => {
    const range: ReportRange = {
      ...(r.minimum !== null ? { min: r.minimum } : {}),
      ...(r.maximum !== null ? { max: r.maximum } : {}),
    };
    const hasRange = range.min !== undefined || range.max !== undefined;
    return {
      label: r.elementCode,
      measured: `${formatReportNumber(r.value)} ${r.unit}`.trim(),
      previous: null,
      target: hasRange ? formatReportRange(range, r.unit) : null,
      status: hasRange ? reportStatus(r.value, range) : null,
      direction: hasRange ? distanceFromRange(r.value, range).direction : null,
      trend: null,
    };
  });
}

/** D3: the latest ICP report sampled within 14 days before the occasion. */
export const ICP_WINDOW_DAYS = 14;

/**
 * The day an ICP report counts from: its sampling day, or, when the
 * laboratory gave none, the day it was uploaded (barracuda's review, #1640),
 * so a report without a sampling date never drops off the PDF.
 */
export function icpReportDay(report: {
  sampledAt: Date | null;
  createdAt: Date;
}): Date {
  return report.sampledAt ?? report.createdAt;
}

/** D3, with the fallback: the latest report whose day falls in the window. */
export function pickIcpReport<
  T extends { sampledAt: Date | null; createdAt: Date },
>(reports: readonly T[], window: { from: Date; to: Date }): T | null {
  let best: T | null = null;
  for (const report of reports) {
    const day = icpReportDay(report).getTime();
    if (day < window.from.getTime() || day > window.to.getTime()) continue;
    if (!best || day > icpReportDay(best).getTime()) best = report;
  }
  return best;
}

export function icpWindow(measuredAt: string): { from: Date; to: Date } {
  const to = new Date(measuredAt);
  return { from: new Date(to.getTime() - ICP_WINDOW_DAYS * 86_400_000), to };
}

export function deviationCount(rows: readonly ReportRow[]): number {
  return rows.filter((r) => r.status === "WARN" || r.status === "ALERT").length;
}

const BUDAPEST = new Intl.DateTimeFormat("hu-HU", {
  timeZone: "Europe/Budapest",
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** "2026. október 8. 10:45", in Budapest time. */
export function formatReportMoment(iso: string): string {
  return BUDAPEST.format(new Date(iso));
}
