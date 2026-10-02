import {
  aquariumEffectiveMeasurementTargetRange,
  aquariumMeasurementParametersFor,
  type AquariumMeasurementParameterCode,
  type DashboardAquariumAlertsWidgetData,
  type DashboardWaterValuesWidgetData,
  type WaterType,
} from "@acropora/types";

/** The same staleness rule as the old dashboard card. */
export const STALE_AFTER_DAYS = 14;
const ALERT_ITEMS = 5;
const SUMMARY_CODES = ["KH", "FOSZFAT", "NITRAT"] as const;

export interface AquariumReading {
  id: string;
  name: string;
  waterType: WaterType | null;
  targets: {
    parameterCode: string;
    min: number | null;
    max: number | null;
  }[];
  /** The latest measurement OCCASION (all rows sharing the newest `measuredAt`). */
  latest: {
    measuredAt: Date;
    values: { parameterCode: string; value: number }[];
  } | null;
}

/**
 * THE RULE, ONE PLACE, NO DATABASE (`docs/dashboard/v1-discovery.md` §4).
 *
 *   - compare the LATEST OCCASION, as the aquarium page and the old card do;
 *   - the range is `aquariumEffectiveMeasurementTargetRange`: the aquarium's
 *     own row, else the marine default, else NONE, and no range means no
 *     alert: no limit is invented here;
 *   - the bounds are INCLUSIVE (a value equal to `max` is in range);
 *   - a code not valid for the aquarium's water type is ignored;
 *   - an aquarium with no reading, or one older than `STALE_AFTER_DAYS`, is
 *     STALE: counted separately, never judged on old values.
 */
export function aquariumFindings(
  aquariums: readonly AquariumReading[],
  now: Date,
): {
  alerts: DashboardAquariumAlertsWidgetData;
  waterValues: DashboardWaterValuesWidgetData;
} {
  const staleBefore = now.getTime() - STALE_AFTER_DAYS * 86_400_000;
  const outOfRange: DashboardAquariumAlertsWidgetData["items"] = [];
  let staleCount = 0;
  let freshCount = 0;
  const summary = SUMMARY_CODES.map((code) => ({
    code,
    inRange: 0,
    outOfRange: 0,
    noTarget: 0,
    notMeasured: 0,
  }));

  for (const aquarium of aquariums) {
    const latest = aquarium.latest;
    if (!latest || latest.measuredAt.getTime() < staleBefore) {
      staleCount += 1;
      continue;
    }
    freshCount += 1;
    const allowed = new Set<string>(
      aquariumMeasurementParametersFor(aquarium.waterType).map((p) => p.code),
    );
    const targets = aquarium.targets.map((target) => ({
      parameterCode: target.parameterCode as AquariumMeasurementParameterCode,
      min: target.min ?? undefined,
      max: target.max ?? undefined,
    }));
    const judge = (code: string, value: number) => {
      const range = aquariumEffectiveMeasurementTargetRange(
        aquarium.waterType,
        code as AquariumMeasurementParameterCode,
        targets,
      );
      if (!range) return { verdict: "noTarget" as const, range };
      const below = range.min !== undefined && value < range.min;
      const above = range.max !== undefined && value > range.max;
      return {
        verdict: below || above ? ("out" as const) : ("in" as const),
        range,
      };
    };

    for (const reading of latest.values) {
      if (!allowed.has(reading.parameterCode)) continue;
      const { verdict, range } = judge(reading.parameterCode, reading.value);
      if (verdict === "out")
        outOfRange.push({
          aquariumId: aquarium.id,
          aquariumName: aquarium.name,
          parameterCode: reading.parameterCode,
          value: reading.value,
          min: range?.min ?? null,
          max: range?.max ?? null,
          measuredAt: latest.measuredAt.toISOString(),
        });
    }

    for (const row of summary) {
      const reading = latest.values.find((v) => v.parameterCode === row.code);
      if (!reading || !allowed.has(row.code)) {
        row.notMeasured += 1;
        continue;
      }
      const { verdict } = judge(row.code, reading.value);
      if (verdict === "noTarget") row.noTarget += 1;
      else if (verdict === "out") row.outOfRange += 1;
      else row.inRange += 1;
    }
  }

  outOfRange.sort((a, b) => b.measuredAt.localeCompare(a.measuredAt));
  return {
    alerts: {
      checked: aquariums.length,
      outOfRangeCount: outOfRange.length,
      staleCount,
      staleAfterDays: STALE_AFTER_DAYS,
      items: outOfRange.slice(0, ALERT_ITEMS),
    },
    waterValues: {
      aquariumCount: aquariums.length,
      freshCount,
      staleAfterDays: STALE_AFTER_DAYS,
      parameters: summary,
    },
  };
}
