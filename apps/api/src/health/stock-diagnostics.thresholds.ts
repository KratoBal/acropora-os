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

/// Checkpoint 7: even a SUCCESS ReleaseEvidence row for the EXACT current
/// commit is only trusted if it isn't implausibly old - guards against a
/// long-running container that was deployed, then had its evidence row's
/// underlying CI run's guarantees erode over an extended period (e.g. a
/// dependency's transitive behavior changing without a new commit/deploy -
/// an edge case, not the primary defense, since the primary defense is the
/// exact commitSha match itself).
export const RELEASE_EVIDENCE_MAX_AGE_DAYS = 30;

/// Checkpoint 8: production runs `postgres:16-alpine` (see
/// docker-compose.yml and .github/workflows/ci.yml's service containers).
/// A ReleaseEvidence row is only sufficient to unblock activation-readiness
/// if it was recorded against this exact PostgreSQL MAJOR version - a
/// PostgreSQL 18.4 run (checkpoint 7's own embedded-postgres verification,
/// still valuable as supplementary compatibility evidence, see
/// docs/INVENTORY-CONSISTENCY.md) must never be treated as equivalent to a
/// PostgreSQL 16 run for this gate. Compared as a string prefix against
/// ReleaseEvidence.databaseEngineVersion (e.g. "16-alpine", "16.14"), not
/// an exact-string match, since the exact patch/build suffix legitimately
/// varies between CI runs.
export const REQUIRED_DATABASE_ENGINE = "postgres";
export const REQUIRED_DATABASE_ENGINE_MAJOR_VERSION_PREFIX = "16";

/// Checkpoint 8: the GitHub repository slug this deployment's evidence
/// must have been recorded against - rejects a foreign repository's
/// (e.g. a similarly-named unrelated fork's) evidence row even in the
/// hypothetical case its commitSha happened to collide. Overridable via
/// env var only for local/alternate-fork development; the fallback is
/// this project's actual repository.
export const EXPECTED_RELEASE_EVIDENCE_REPOSITORY =
  process.env.RELEASE_EVIDENCE_EXPECTED_REPOSITORY?.trim() ||
  "KratoBal/acropora-os";

/// Checkpoint 8: GitHub Actions event names trusted enough to unblock
/// production activation-readiness. `push` (a real merge/commit landing on
/// a branch) and `workflow_dispatch` (the release-evidence-handoff.yml
/// manual, reviewer-gated re-run) both represent evidence tied to a
/// reviewed, non-fork-controlled action. `pull_request`/
/// `pull_request_target` are deliberately excluded - even a same-repo PR's
/// tests passing is real and useful CI signal, but treating it as
/// sufficient for PRODUCTION activation-readiness would mean an
/// as-yet-unmerged, unreviewed branch could satisfy the gate for whatever
/// commit ends up on main with the same SHA prefix confusion risk, and
/// forked PRs must categorically never be able to (see
/// .github/workflows/ci.yml's own fork guard on the evidence-recording
/// step, which is defense-in-depth to THIS check, not a substitute for it).
export const TRUSTED_RELEASE_EVIDENCE_TRIGGER_EVENTS = new Set([
  "push",
  "workflow_dispatch",
]);

/// Checkpoint 9: activation-readiness must also confirm the SUCCESS row
/// actually identifies the specific test this gate cares about (the
/// application-level UNAS order-sync advisory-lock concurrency test),
/// not merely "some PostgreSQL 16 test suite, from the right repository,
/// on a trusted trigger, passed" - a row whose testSuite field names an
/// unrelated or incomplete suite must not satisfy this gate. Checked as
/// a substring match (not exact equality) against
/// ReleaseEvidence.testSuite, since the exact wording of that field is a
/// human-written CI step description (see ci.yml/release-evidence-
/// handoff.yml's RELEASE_EVIDENCE_TEST_SUITE values) that may reasonably
/// vary in framing without changing what was actually tested.
export const EXPECTED_TEST_SUITE_SUBSTRING =
  "unas-order-sync.repository.integration.spec.ts";
