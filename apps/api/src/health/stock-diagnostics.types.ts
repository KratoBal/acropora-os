/// DTOs for the checkpoint-6 health/diagnostics surface
/// (stock-diagnostics.{thresholds,repository,service,controller}.ts). See
/// docs/INVENTORY-CONSISTENCY.md's "Health és diagnosztika" section for the
/// full design rationale.

/// Four-state severity vocabulary, distinct from (and coarser than) the
/// per-pair ReconciliationStatus in stock-reconciliation.types.ts. OK: no
/// action needed. DEGRADED: worth looking at, not an incident by itself
/// (e.g. a normal-sized PENDING backlog past the "instant" threshold, or a
/// FAILED row the worker's own retry may still resolve). BLOCKED: a
/// dependency is down, or a signal genuinely requires human action before
/// the affected subsystem can be trusted. UNKNOWN: the signal itself
/// couldn't be computed (e.g. no data yet, or the check itself errored) -
/// deliberately NOT folded into DEGRADED or OK, since "we don't know" is a
/// different fact than "we know it's fine" or "we know it's a problem".
export type DiagnosticStatus = "OK" | "DEGRADED" | "BLOCKED" | "UNKNOWN";

export interface LivenessResult {
  status: "OK";
  uptimeSeconds: number;
  timestamp: string;
}

export interface RequiredTableCheck {
  table: string;
  reachable: boolean;
}

export interface ReadinessResult {
  status: DiagnosticStatus;
  database: { reachable: boolean; latencyMs: number | null };
  requiredTables: RequiredTableCheck[];
  timestamp: string;
}

export interface OutboxBacklogDiagnostics {
  status: DiagnosticStatus;
  pendingCount: number;
  failedCount: number;
  deadLetterCount: number;
  processingCount: number;
  expiredProcessingLeaseCount: number;
  /** Null when there is no PENDING row at all - not zero, to avoid
   * conflating "nothing pending" with "the oldest pending row is brand
   * new". */
  oldestPendingAgeSeconds: number | null;
}

export interface UnasSnapshotFreshnessDiagnostics {
  status: DiagnosticStatus;
  /** Products with a non-null reportedStock at all - the population this
   * freshness check is even meaningful for. */
  productsWithReportedStock: number;
  /** Of those, how many either never recorded reportedStockSyncedAt, or
   * recorded it longer ago than UNAS_SNAPSHOT_STALE_HOURS_UNKNOWN. */
  productsWithUnknownFreshness: number;
  oldestSyncAgeHours: number | null;
}

export interface MigrationDiagnostics {
  status: DiagnosticStatus;
  /** True only when both the on-disk migration list AND the database's
   * _prisma_migrations table were readable - false (status UNKNOWN) if
   * either read failed, e.g. the migrations directory isn't present in
   * this deployment's runtime filesystem layout. */
  checked: boolean;
  expectedCount: number;
  appliedCount: number;
  missing: string[];
}

export interface UnasConfigDiagnostics {
  apiKeyConfigured: boolean;
  apiUrlIsDefault: boolean;
}

export interface ReconciliationSummarySnapshot {
  checkedCount: number;
  historicalBaselineUnknownCount: number;
  invalidLedgerDataCount: number;
  localLedgerMismatchCount: number;
}

export interface UnasOrderAuditSnapshot {
  ordersChecked: number;
  ordersWithRiskFlags: number;
}

export interface StockDiagnosticsReport {
  status: DiagnosticStatus;
  checkedAt: string;
  database: { reachable: boolean; latencyMs: number | null };
  requiredTables: RequiredTableCheck[];
  outbox: OutboxBacklogDiagnostics;
  unasSnapshotFreshness: UnasSnapshotFreshnessDiagnostics;
  reconciliation: ReconciliationSummarySnapshot;
  unasOrderAudit: UnasOrderAuditSnapshot;
  migrations: MigrationDiagnostics;
  unasConfig: UnasConfigDiagnostics;
  /** Free-text, non-sensitive technical notes - e.g. why a given signal is
   * UNKNOWN. Never customer/order personal data, never secrets. */
  notes: string[];
}

/// Read-only, checkpoint-9-required activation-readiness result for the
/// UNAS delta booking/storno engine. Deliberately separate from
/// StockDiagnosticsReport: the diagnostics report answers "is the system
/// healthy right now", this answers the narrower, higher-stakes question
/// "may the UNAS delta engine be safely turned on in production" - the two
/// can disagree (e.g. a healthy-looking system can still be BLOCKED here
/// solely because the Postgres concurrency test has no recorded release
/// evidence).
/// - "NOT_CONFIGURED": the running build doesn't even know its own commit
///   (RELEASE_COMMIT_SHA unset) - no evidence lookup is even possible.
/// - "NOT_DEMONSTRATED": the commit is known, but no matching SUCCESS
///   ReleaseEvidence row exists for it (checkpoint 6's permanent state,
///   before any real CI wiring existed at all).
/// - "DEMONSTRATED": a genuine SUCCESS row exists for the EXACT running
///   commit - see ActivationReadinessResult's own doc comment for why an
///   old commit's SUCCESS may never satisfy a new one.
export type ConcurrencyTestEvidenceState = "NOT_CONFIGURED" | "NOT_DEMONSTRATED" | "DEMONSTRATED";

export interface ActivationReadinessResult {
  safeToActivate: boolean;
  blockingReasons: string[];
  warnings: string[];
  checkedAt: string;
  /** The commit this check was evaluated against, or null if
   * RELEASE_COMMIT_SHA isn't configured on the running build - see
   * common/release-info.util.ts. */
  evaluatedCommitSha: string | null;
  /** See stock-diagnostics.service.ts's own doc comment on why a stale or
   * foreign-commit SUCCESS row must never silently unblock a new release -
   * this can only become "DEMONSTRATED" via a genuine
   * packages/database/prisma/record-release-evidence.ts run (itself only
   * runnable by a real CI/release process, never through any HTTP API),
   * for the EXACT commit currently evaluated. */
  concurrencyTestEvidence: ConcurrencyTestEvidenceState;
}
