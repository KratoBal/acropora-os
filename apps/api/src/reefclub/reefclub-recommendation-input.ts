import {
  RECOMMENDATION_PARAMETERS,
  type AdministrationRecord,
  type DoseRow,
  type MeasurementPoint,
  type PriorRecommendation,
  type RecommendationInput,
  type TargetBand,
} from "@acropora/aquarium-calc";
import {
  aquariumEffectiveMeasurementTargetRange,
  measurementStatus,
  type AquariumMeasurementParameterCode,
  type WaterType,
} from "@acropora/types";

import { REEFCLUB_MANUAL_SOURCE } from "./reefclub-aquariums.service.js";

/**
 * THE ROWS OF THE DATABASE, TURNED INTO THE ENGINE'S INPUT (ReefClub plan
 * v6.1, 6; slice 8, service PR). A pure function, so every mapping the engine
 * relies on is tested without a database. The service reads the rows and
 * hands them here; nothing in here reaches outside its argument.
 *
 * The mappings that carry a safety meaning:
 *
 *  - a measurement is `SHOP` only on a SHOP aquarium and only if its source is
 *    not the customer's own manual one; everything else, an unknown or missing
 *    source included, is `MANUAL` (barracuda, #1757): the gate that wants a
 *    repeat for an alarm-level manual value must not be opened by a guess, and
 *    a wrong guess toward MANUAL costs a repeat measurement, a wrong guess
 *    toward SHOP costs a lifted alarm;
 *  - `alert` is `measurementStatus(...) === "ALERT"` against the SAME band
 *    this input carries, so the engine and the screens call the same value an
 *    alarm;
 *  - a projected row whose refusal list is MISSING (the column is a nullable
 *    array in SQL) is a refused row, never a live one;
 *  - a stored recommendation still open past its effect time is EXPIRED;
 *  - a stored recommendation whose reserved changes cannot be read is an
 *    ERROR, not an empty list: an empty list would free the daily limit.
 */

/** How far back the history is read: the longest effect time that matters, with margin. */
export const RECOMMENDATION_HISTORY_DAYS = 14;

interface Decimalish {
  toNumber(): number;
}

export interface RawAquarium {
  systemVolumeLiters: Decimalish | null;
  waterType: WaterType | null;
  targets: readonly {
    parameterCode: string;
    min: Decimalish | null;
    max: Decimalish | null;
  }[];
}

export interface RawMeasurement {
  id: string;
  parameterCode: string;
  value: Decimalish;
  measuredAt: Date;
  /** Null: no source recorded, which is not the customer's own manual entry. */
  source: string | null;
}

export interface RawDoseRow {
  sourceId: string;
  sourceVersion: number;
  productId: string;
  productName: string;
  parameterCode: string;
  direction: "EMEL" | "CSOKKENT";
  effectPer100L: Decimalish;
  doseUnit: "ML" | "G" | "CSEPP";
  doseStep: Decimalish;
  maxDailyDosePer100L: Decimalish | null;
  effectHours: number | null;
  source: string;
  refusals: readonly string[] | null;
  inStock: boolean | null;
  pricePerDoseUnit: Decimalish | null;
}

export interface RawAdministration {
  id: string;
  administeredAt: Date;
  parameterCode: string;
  productId: string | null;
  amount: Decimalish | null;
  doseUnit: "ML" | "G" | "CSEPP" | null;
}

export interface RawRecommendation {
  id: string;
  createdAt: Date;
  parameterCode: string;
  basisMeasurementId: string | null;
  productId: string | null;
  amount: Decimalish;
  doseUnit: "ML" | "G" | "CSEPP";
  status: "OPEN" | "GIVEN" | "PARTIAL" | "NOT_GIVEN";
  effectEndsAt: Date;
  reservedChanges: unknown;
}

export interface RecommendationRawData {
  now: Date;
  /** Whose aquarium this is for the asking account: its own, or the linked customer's. */
  origin: "OWN" | "SHOP";
  parameter: string;
  aquarium: RawAquarium;
  measurements: readonly RawMeasurement[];
  rows: readonly RawDoseRow[];
  doseListBuiltAt: Date | null;
  administrations: readonly RawAdministration[];
  recommendations: readonly RawRecommendation[];
}

/** The refusal code of a projected row whose refusal list is missing. */
export const PROJECTION_REFUSALS_MISSING = "PROJECTION_REFUSALS_MISSING";

/**
 * THE AGE OF THE DOSE LIST IS THE AGE OF THE RUN THE ROWS CAME FROM (barracuda,
 * #1757). The rows and the latest run are two reads; a build that commits
 * between them would give the OLD rows the NEW run's time, and a list that
 * failed to build for thirty hours would pass the gate at the moment of its
 * first success. Every row carries the `runId` of the full rebuild it came
 * from, so the time comes from THAT run: all rows from one SUCCEEDED run, or
 * the list is stale (null). An empty set has no age to speak of (no row, no
 * dose), and keeps the latest successful run's time.
 */
export function doseListBuiltAt(
  rows: readonly { runId: string }[],
  runs: readonly { id: string; status: string; finishedAt: Date }[],
  latestSuccessAt: Date | null,
): Date | null {
  if (rows.length === 0) return latestSuccessAt;
  const runIds = new Set(rows.map((row) => row.runId));
  if (runIds.size !== 1) return null;
  const run = runs.find((candidate) => candidate.id === [...runIds][0]);
  if (!run || run.status !== "SUCCEEDED") return null;
  return run.finishedAt;
}

export function parseReservedChanges(
  value: unknown,
  recommendationId: string,
): { parameter: string; change: number }[] {
  if (!Array.isArray(value))
    throw new Error(
      `A naplózott ajánlás (${recommendationId}) foglalása nem olvasható.`,
    );
  return value.map((entry: unknown) => {
    const candidate = entry as { parameter?: unknown; change?: unknown } | null;
    if (
      !candidate ||
      typeof candidate.parameter !== "string" ||
      typeof candidate.change !== "number" ||
      !Number.isFinite(candidate.change)
    )
      throw new Error(
        `A naplózott ajánlás (${recommendationId}) foglalása nem olvasható.`,
      );
    return { parameter: candidate.parameter, change: candidate.change };
  });
}

export function buildRecommendationInput(
  raw: RecommendationRawData,
): RecommendationInput {
  const targets = raw.aquarium.targets.map((target) => ({
    parameterCode: target.parameterCode as AquariumMeasurementParameterCode,
    min: target.min?.toNumber(),
    max: target.max?.toNumber(),
  }));

  const bands: Record<string, TargetBand | undefined> = {};
  for (const code of RECOMMENDATION_PARAMETERS) {
    const range = aquariumEffectiveMeasurementTargetRange(
      raw.aquarium.waterType,
      code,
      targets,
    );
    bands[code] = range ? { min: range.min, max: range.max } : undefined;
  }

  const measurements: MeasurementPoint[] = raw.measurements
    .filter((row) =>
      (RECOMMENDATION_PARAMETERS as readonly string[]).includes(
        row.parameterCode,
      ),
    )
    .map((row) => {
      const value = row.value.toNumber();
      const band = bands[row.parameterCode];
      return {
        id: row.id,
        // an occasion has no table: its id is its time (aquarium-measurements)
        occasionId: row.measuredAt.toISOString(),
        parameter: row.parameterCode,
        value,
        measuredAt: row.measuredAt,
        source:
          raw.origin === "SHOP" && row.source !== REEFCLUB_MANUAL_SOURCE
            ? "SHOP"
            : "MANUAL",
        alert: band !== undefined && measurementStatus(value, band) === "ALERT",
      };
    });

  const rows: DoseRow[] = raw.rows.map((row) => ({
    rowId: row.sourceId,
    rowVersion: row.sourceVersion,
    productId: row.productId,
    productName: row.productName,
    parameter: row.parameterCode,
    direction: row.direction,
    effectPer100L: row.effectPer100L.toNumber(),
    unit: row.doseUnit,
    step: row.doseStep.toNumber(),
    maxDailyDosePer100L: row.maxDailyDosePer100L?.toNumber() ?? null,
    effectHours: row.effectHours,
    source: row.source,
    refusals: row.refusals ?? [PROJECTION_REFUSALS_MISSING],
    inStock: row.inStock,
    pricePerDoseUnit: row.pricePerDoseUnit?.toNumber() ?? null,
  }));

  const administrations: AdministrationRecord[] = raw.administrations.map(
    (row) => ({
      id: row.id,
      at: row.administeredAt,
      parameter: row.parameterCode,
      productId: row.productId,
      amount: row.amount?.toNumber() ?? null,
      unit: row.doseUnit,
    }),
  );

  const priorRecommendations: PriorRecommendation[] = raw.recommendations.map(
    (row) => ({
      id: row.id,
      createdAt: row.createdAt,
      parameter: row.parameterCode,
      basisMeasurementId: row.basisMeasurementId ?? "",
      productId: row.productId,
      amount: row.amount.toNumber(),
      unit: row.doseUnit,
      status:
        row.status === "OPEN" && row.effectEndsAt.getTime() <= raw.now.getTime()
          ? "EXPIRED"
          : row.status,
      effectEndsAt: row.effectEndsAt,
      changes: parseReservedChanges(row.reservedChanges, row.id),
    }),
  );

  return {
    now: raw.now,
    parameter: raw.parameter,
    volumeLiters: raw.aquarium.systemVolumeLiters?.toNumber() ?? null,
    bands,
    measurements,
    rows,
    administrations,
    priorRecommendations,
    doseListBuiltAt: raw.doseListBuiltAt,
  };
}
