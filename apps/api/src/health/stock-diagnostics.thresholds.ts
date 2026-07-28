/// Centralized thresholds for the checkpoint-6 inventory health/diagnostics
/// module - see stock-diagnostics.service.ts's computeXStatus functions for
/// where each constant is actually consumed. Deliberately not scattered as
/// magic numbers inline (the checkpoint's own explicit requirement,
/// section 8) so a future tuning pass has exactly one place to look.
///
/// Every threshold pair below follows the same OK -> DEGRADED -> BLOCKED
/// shape: below the DEGRADED value is OK, at/above DEGRADED but below
/// BLOCKED is DEGRADED, at/above BLOCKED is BLOCKED.

/// Outbox PENDING backlog size. A short PENDING queue is completely normal
/// operational lag (the scheduler polls periodically - see
/// unas-stock-sync-outbox.scheduler.ts) and must not read as an error; a
/// backlog past DEGRADED suggests the worker is falling behind, past
/// BLOCKED suggests it has effectively stopped making progress.
export const OUTBOX_PENDING_COUNT_DEGRADED = 50;
export const OUTBOX_PENDING_COUNT_BLOCKED = 500;

/// Age (in minutes) of the OLDEST still-open PENDING row. A single old row
/// stuck behind a healthy-looking small queue is a more reliable "is the
/// worker actually running" signal than raw count alone.
export const OUTBOX_OLDEST_PENDING_AGE_MINUTES_DEGRADED = 15;
export const OUTBOX_OLDEST_PENDING_AGE_MINUTES_BLOCKED = 120;

/// Any FAILED row at all is DEGRADED (worth investigating, not fatal - the
/// worker's own retry/backoff may still resolve it); a wholesale queue of
/// FAILED rows crossing this count is BLOCKED (systemic failure, not a
/// transient blip).
export const OUTBOX_FAILED_COUNT_BLOCKED = 20;

/// Any DEAD_LETTER row is inherently DEGRADED-or-worse: the worker has
/// already exhausted its own retry budget for that row and given up: see
/// SYNC_FAILED in stock-reconciliation-status.util.ts for the equivalent
/// per-row reconciliation status this mirrors at the aggregate level.
export const OUTBOX_DEAD_LETTER_COUNT_BLOCKED = 5;

/// UNAS product-snapshot freshness. UnasProductSnapshot.reportedStockSyncedAt
/// is set by the UNAS product importer (apps/api/src/imports/unas), a
/// process entirely outside this checkpoint's scope - this module only
/// reads the timestamp, never triggers a resync. Past DEGRADED the
/// snapshot is old enough that reconciliation's UNAS-side comparison should
/// be treated with more suspicion; there is no BLOCKED tier for this one
/// signal alone (see section 8's explicit instruction that
/// HISTORICAL_BASELINE_UNKNOWN-style uncertainty must not, by itself, make
/// the whole API unhealthy - the same principle applies here).
export const UNAS_SNAPSHOT_STALE_HOURS_DEGRADED = 24;
export const UNAS_SNAPSHOT_STALE_HOURS_UNKNOWN = 168; // 7 days - old enough that "stale" undersells it; treated as UNKNOWN instead of a confident DEGRADED.

/// Reconciliation-summary-derived signals. A LOCAL_LEDGER_MISMATCH is,
/// per stock-reconciliation.types.ts's own doc comment, "always worth
/// investigating; never expected" - so even a single one is DEGRADED, not
/// waved off by a count threshold.
export const RECONCILIATION_LOCAL_LEDGER_MISMATCH_COUNT_DEGRADED = 1;

/// UNAS historical order-audit anomalies. Any risk-flagged order at all
/// BLOCKS the UNAS delta-engine activation gate (see
/// unas-order-stock-audit.service.ts's own summarize() -
/// safeToActivateWithoutBackfill) - this constant exists only so the
/// diagnostics report's own severity classification (which is a distinct,
/// broader signal than the activation gate) uses the same "any is already
/// meaningful" threshold rather than a silently different one.
export const UNAS_ORDER_AUDIT_RISK_ORDER_COUNT_DEGRADED = 1;
