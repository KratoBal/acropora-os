import type { DoseEffectView } from "./dose-effects.service.js";

/**
 * THE PROJECTION OF THE PRODUCT DOSE LIST FOR THE REEFCLUB ROLE (plan v6.1,
 * 6.2; slice 8; path B, decided with acrobot and barracuda on 2026-10-20).
 * The pure parts: what a projected row holds, how old a projection may be,
 * and what the status says. The service that rebuilds it is
 * `dose-projection.service.ts`.
 *
 * THE AGE OF THE PROJECTION IS THE LAST SUCCESSFUL FULL REBUILD, NOT A ROW'S
 * `updatedAt` (barracuda): a row that did not change does not age, and a
 * rebuilder that stopped leaves old timestamps that say nothing. The limit is
 * 26 hours for an hourly schedule with a margin; past it the ReefClub gives no
 * dose.
 */
export const DOSE_PROJECTION_MAX_AGE_HOURS = 26;

export type DoseProjectionTrigger = "EDIT" | "SCHEDULE" | "STARTUP";

export interface ProjectedRow {
  sourceId: string;
  sourceVersion: number;
  productId: string;
  productName: string;
  parameterCode: string;
  direction: "EMEL" | "CSOKKENT";
  effectPer100L: number;
  doseUnit: "ML" | "G" | "CSEPP";
  doseStep: number;
  maxDailyDosePer100L: number | null;
  effectHours: number | null;
  source: string;
  /** The `doseEffectRefusals` codes; empty: the row is live. */
  refusals: string[];
  inStock: boolean | null;
  pricePerDoseUnit: number | null;
}

/**
 * One list row as the projection keeps it. The version is the SOURCE's, so a
 * logged `rowId` and `rowVersion` lead back to the dose-list row. Stock and
 * price have no source yet and stay unknown.
 */
export function toProjectedRow(view: DoseEffectView): ProjectedRow {
  return {
    sourceId: view.id,
    sourceVersion: view.version,
    productId: view.productId,
    productName: view.productName,
    parameterCode: view.parameterCode,
    direction: view.direction,
    effectPer100L: view.effectPer100L,
    doseUnit: view.doseUnit,
    doseStep: view.doseStep,
    maxDailyDosePer100L: view.maxDailyDosePer100L,
    effectHours: view.effectHours,
    source: view.source,
    refusals: [...view.refusals],
    inStock: null,
    pricePerDoseUnit: null,
  };
}

/** Whether a projection built at `lastSuccessAt` is too old; none ever built is stale. */
export function isDoseProjectionStale(
  lastSuccessAt: Date | null,
  now: Date,
): boolean {
  if (!lastSuccessAt) return true;
  const ageMs = now.getTime() - lastSuccessAt.getTime();
  return ageMs > DOSE_PROJECTION_MAX_AGE_HOURS * 60 * 60 * 1000;
}

export interface ProjectionRunRecord {
  trigger: string;
  startedAt: Date;
  finishedAt: Date;
  rowCount: number | null;
  errorMessage: string | null;
}

export interface DoseProjectionStatus {
  /** The gate: true if there is no successful build or it is older than the limit. */
  stale: boolean;
  maxAgeHours: number;
  /** Hours since the last successful build; null if none. */
  ageHours: number | null;
  rowCount: number;
  lastSuccess: {
    trigger: string;
    startedAt: string;
    finishedAt: string;
    rowCount: number;
  } | null;
  /** The last failed build, shown whether or not a later one succeeded. */
  lastFailure: {
    trigger: string;
    finishedAt: string;
    errorMessage: string;
  } | null;
  /** True if the last failure is newer than the last success: the rebuilder is failing NOW. */
  failingSinceLastSuccess: boolean;
}

export function doseProjectionStatus(input: {
  success: ProjectionRunRecord | null;
  failure: ProjectionRunRecord | null;
  rowCount: number;
  now: Date;
}): DoseProjectionStatus {
  const { success, failure, rowCount, now } = input;
  return {
    stale: isDoseProjectionStale(success?.finishedAt ?? null, now),
    maxAgeHours: DOSE_PROJECTION_MAX_AGE_HOURS,
    ageHours: success
      ? Math.round(
          ((now.getTime() - success.finishedAt.getTime()) / 3_600_000) * 100,
        ) / 100
      : null,
    rowCount,
    lastSuccess: success
      ? {
          trigger: success.trigger,
          startedAt: success.startedAt.toISOString(),
          finishedAt: success.finishedAt.toISOString(),
          rowCount: success.rowCount ?? 0,
        }
      : null,
    lastFailure: failure
      ? {
          trigger: failure.trigger,
          finishedAt: failure.finishedAt.toISOString(),
          errorMessage: failure.errorMessage ?? "",
        }
      : null,
    failingSinceLastSuccess:
      failure !== null &&
      (success === null ||
        failure.finishedAt.getTime() > success.finishedAt.getTime()),
  };
}
