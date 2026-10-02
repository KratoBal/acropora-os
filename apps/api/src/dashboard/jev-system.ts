import type {
  DashboardJevCounts,
  DashboardJevIntelligenceWidgetData,
  DashboardSystemState,
} from "@acropora/types";

export const JEV_WINDOW_DAYS = 7;

/** One `groupBy(["policyKey","exposure","resolution","status"])` row. */
export interface DecisionRunGroup {
  policyKey: string;
  exposure: "HIDDEN" | "SHOWN";
  resolution:
    | "ACCEPTED"
    | "OVERRIDDEN"
    | "SHADOW_MATCH"
    | "SHADOW_MISMATCH"
    | "STALE"
    | "EXPIRED"
    | null;
  status: "OK" | "ERROR";
  count: number;
}

const zero = (): DashboardJevCounts => ({
  runs: 0,
  errors: 0,
  shown: { accepted: 0, overridden: 0, lapsed: 0, open: 0 },
  shadow: { match: 0, mismatch: 0, open: 0 },
});

function add(into: DashboardJevCounts, group: DecisionRunGroup): void {
  into.runs += group.count;
  // a failed run has no result: an error, never a shown or shadow figure
  if (group.status === "ERROR") {
    into.errors += group.count;
    return;
  }
  if (group.exposure === "SHOWN") {
    if (group.resolution === "ACCEPTED") into.shown.accepted += group.count;
    else if (group.resolution === "OVERRIDDEN")
      into.shown.overridden += group.count;
    else if (group.resolution === "STALE" || group.resolution === "EXPIRED")
      into.shown.lapsed += group.count;
    else into.shown.open += group.count;
    return;
  }
  // HIDDEN: a shadow measurement, only its agreement with the person counts
  if (group.resolution === "SHADOW_MATCH") into.shadow.match += group.count;
  else if (group.resolution === "SHADOW_MISMATCH")
    into.shadow.mismatch += group.count;
  else into.shadow.open += group.count;
}

/** The JEV intelligencia card from the week's groups and today's status counts. */
export function summarizeDecisionRuns(
  week: readonly DecisionRunGroup[],
  today: readonly { status: "OK" | "ERROR"; count: number }[],
): DashboardJevIntelligenceWidgetData {
  const total = zero();
  const byPolicy = new Map<string, DashboardJevCounts>();
  for (const group of week) {
    add(total, group);
    const policy = byPolicy.get(group.policyKey) ?? zero();
    add(policy, group);
    byPolicy.set(group.policyKey, policy);
  }
  return {
    windowDays: JEV_WINDOW_DAYS,
    today: {
      runs: today.reduce((sum, row) => sum + row.count, 0),
      errors: today
        .filter((row) => row.status === "ERROR")
        .reduce((sum, row) => sum + row.count, 0),
    },
    week: total,
    policies: [...byPolicy.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([policyKey, counts]) => ({ policyKey, ...counts })),
  };
}

export interface SyncRunSnapshot {
  status: string;
  at: Date | null;
  errorCode: string | null;
  /** The run's own count of items it could not process, when it keeps one. */
  failedCount?: number;
}

export interface SourceState {
  state: DashboardSystemState;
  detail: string | null;
}

/**
 * A sync source's state from its LAST run only. A running run is not judged
 * (no invented "too long" threshold); its start time is shown.
 */
export function syncRunState(run: SyncRunSnapshot | null): SourceState {
  if (!run) return { state: "no-data", detail: "Még nem futott." };
  if (run.status === "FAILED")
    return {
      state: "error",
      detail: "Az utolsó futás hibával állt le.",
    };
  if (run.status === "RUNNING" || run.status === "PENDING")
    return { state: "ok", detail: "Fut." };
  if (run.failedCount && run.failedCount > 0)
    return {
      state: "warning",
      detail: `${run.failedCount} tételt nem sikerült feldolgozni.`,
    };
  return { state: "ok", detail: null };
}

/**
 * OTP eBIZ (2026-10-02): without `OTP_EBIZ_API_KEY` the sync never runs, and
 * that is "not configured", not an error and not "has not run yet"; with the
 * key it is a sync like the others.
 */
export function ebizState(
  configured: boolean,
  run: SyncRunSnapshot | null,
): SourceState {
  if (!configured) return { state: "no-data", detail: "Nincs beállítva." };
  return syncRunState(run);
}

const SEVERITY: Record<DashboardSystemState, number> = {
  "no-data": 0,
  ok: 1,
  warning: 2,
  error: 3,
};

/**
 * NAV: the last run and the stored connection verification (owner decision,
 * 2026-10-02). A connection never verified is no data, not a warning: only a
 * verification that actually failed warns. A failed run is still an error.
 */
export function navState(
  run: SyncRunSnapshot | null,
  verification: "NEVER" | "SUCCESS" | "FAILED" | null,
): SourceState {
  const fromRun = syncRunState(run);
  if (verification === "FAILED") {
    const failed: SourceState = {
      state: "warning",
      detail: "A NAV-kapcsolat ellenőrzése hibát adott.",
    };
    return SEVERITY[fromRun.state] > SEVERITY[failed.state] ? fromRun : failed;
  }
  if (verification === "SUCCESS") return fromRun;
  // never verified (or no setting row): nothing to judge the connection by
  if (fromRun.state === "error" || fromRun.state === "warning") return fromRun;
  return {
    state: "no-data",
    detail: "A NAV-kapcsolat még nincs ellenőrizve.",
  };
}

/** JEV: today's runs; all failing is an error, some failing a warning. */
export function jevState(today: { runs: number; errors: number }): SourceState {
  if (today.runs === 0) return { state: "no-data", detail: "Ma nem futott." };
  if (today.errors === today.runs)
    return { state: "error", detail: "Ma minden futás hibás." };
  if (today.errors > 0)
    return {
      state: "warning",
      detail: `Ma ${today.errors} / ${today.runs} futás hibás.`,
    };
  return { state: "ok", detail: null };
}
