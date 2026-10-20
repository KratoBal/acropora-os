import { AQUARIUM_MEASUREMENT_PARAMETERS } from "@acropora/types";

import type { ReefClubMeasurementValue, ReefClubOccasion } from "./types";

export const STATUS_LABEL = {
  OK: "Rendben",
  WARN: "Figyelmeztetés",
  ALERT: "Riasztás",
} as const;

export const TREND_LABEL = {
  IMPROVING: "javul",
  WORSENING: "romlik",
  STABLE: "stabil",
} as const;

export const DIRECTION_LABEL = { LOW: "alacsony", HIGH: "magas" } as const;

/** The catalog's own name for a parameter code; an unknown code is shown as it is, not guessed. */
export function parameterLabel(code: string): string {
  return (
    AQUARIUM_MEASUREMENT_PARAMETERS.find((p) => p.code === code)?.label ?? code
  );
}

export interface SeriesPoint {
  /** Milliseconds, for the chart's time axis. */
  at: number;
  measuredAt: string;
  value: number;
}

/** The parameters that have at least one value, in the catalog's order. */
export function measuredParameters(
  occasions: readonly ReefClubOccasion[],
): string[] {
  const seen = new Set(
    occasions.flatMap((o) => o.values.map((v) => v.parameterCode)),
  );
  const known = AQUARIUM_MEASUREMENT_PARAMETERS.map(
    (p) => p.code as string,
  ).filter((code) => seen.has(code));
  const unknown = [...seen].filter((code) => !known.includes(code)).sort();
  return [...known, ...unknown];
}

/** One parameter's values over time, oldest first. */
export function seriesFor(
  code: string,
  occasions: readonly ReefClubOccasion[],
): SeriesPoint[] {
  const points: SeriesPoint[] = [];
  for (const occasion of occasions) {
    const value = occasion.values.find((v) => v.parameterCode === code);
    if (value)
      points.push({
        at: Date.parse(occasion.measuredAt),
        measuredAt: occasion.measuredAt,
        value: value.value,
      });
  }
  return points.sort((a, b) => a.at - b.at);
}

/** The range the newest value of the parameter was judged against, for the chart's band. */
export function latestTarget(
  code: string,
  occasions: readonly ReefClubOccasion[],
): ReefClubMeasurementValue["target"] {
  const newest = [...occasions].sort(
    (a, b) => Date.parse(b.measuredAt) - Date.parse(a.measuredAt),
  );
  for (const occasion of newest) {
    const value = occasion.values.find((v) => v.parameterCode === code);
    if (value) return value.target;
  }
  return null;
}

export function formatValue(value: number): string {
  return new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 4 }).format(
    value,
  );
}
