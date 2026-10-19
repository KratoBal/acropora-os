import {
  aquariumEffectiveMeasurementTargetRange,
  aquariumMeasurementParameter,
  measurementDistanceFromRange,
  measurementStatus,
  measurementTrend,
  type AquariumMeasurementOccasion,
  type AquariumMeasurementParameterCode,
  type AquariumMeasurementTarget,
  type MeasurementRange,
  type MeasurementStatus,
  type MeasurementTrend,
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

// THE RULE ITSELF (D1, D2) IS SHARED: @acropora/types,
// aquarium-measurement-evaluation.ts. The report keeps its own names for it.
export const distanceFromRange = measurementDistanceFromRange;
export const reportStatus = measurementStatus;
export const reportTrend = measurementTrend;
export type ReportRange = MeasurementRange;
export type ReportStatus = MeasurementStatus;
export type ReportTrend = MeasurementTrend;

export interface ReportRow {
  label: string;
  measured: string;
  previous: string | null;
  target: string | null;
  status: ReportStatus | null;
  direction: "LOW" | "HIGH" | null;
  trend: ReportTrend | null;
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
