import {
  aquariumEffectiveMeasurementTargetRange,
  aquariumMeasurementParameter,
  type AquariumMeasurementOccasion,
  type AquariumMeasurementParameterCode,
  type AquariumMeasurementTarget,
  type WaterType,
} from "@acropora/types";

import {
  distanceFromRange,
  previousValues,
  reportStatus,
  reportTrend,
} from "../measurement-report.js";
import type { RecommendationDeviation } from "./measurement-recommendation.contract.js";

/**
 * AZ AJÁNLÁS BEMENETE: az alkalom eltérő sorai, ugyanazokkal a szabályokkal,
 * amikkel a PDF jelzi őket (D1 állapot, D2 trend, a célsáv az egy közös
 * helyről). A rendben lévő és a célsáv nélküli sor nem megy az AI-nak.
 */
export function recommendationDeviations(
  occasion: AquariumMeasurementOccasion,
  occasions: readonly AquariumMeasurementOccasion[],
  waterType: WaterType | null | undefined,
  targets: readonly AquariumMeasurementTarget[],
): RecommendationDeviation[] {
  const previous = previousValues(occasions, occasion);
  return occasion.values.flatMap((v) => {
    const code = v.parameterCode as AquariumMeasurementParameterCode;
    const range = aquariumEffectiveMeasurementTargetRange(
      waterType,
      code,
      targets,
    );
    if (!range || (range.min === undefined && range.max === undefined))
      return [];
    const status = reportStatus(v.value, range);
    const { direction } = distanceFromRange(v.value, range);
    if (status === "OK" || !direction) return [];
    return [
      {
        parameterCode: code,
        measured: v.value,
        unit: aquariumMeasurementParameter(code)?.unit ?? "",
        ...(range.min !== undefined ? { min: range.min } : {}),
        ...(range.max !== undefined ? { max: range.max } : {}),
        status,
        direction,
        trend: reportTrend(v.value, previous.get(code), range),
      },
    ];
  });
}
