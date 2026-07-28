import { Injectable } from "@nestjs/common";

import { StockReconciliationService } from "../inventory/stock-reconciliation.service.js";
import { UnasOrderStockAuditService } from "../orders/unas-order-sync/unas-order-stock-audit.service.js";
import { StockDiagnosticsRepository } from "./stock-diagnostics.repository.js";
import {
  OUTBOX_DEAD_LETTER_COUNT_BLOCKED,
  OUTBOX_FAILED_COUNT_BLOCKED,
  OUTBOX_OLDEST_PENDING_AGE_MINUTES_BLOCKED,
  OUTBOX_OLDEST_PENDING_AGE_MINUTES_DEGRADED,
  OUTBOX_PENDING_COUNT_BLOCKED,
  OUTBOX_PENDING_COUNT_DEGRADED,
  RECONCILIATION_LOCAL_LEDGER_MISMATCH_COUNT_DEGRADED,
  UNAS_ORDER_AUDIT_RISK_ORDER_COUNT_DEGRADED,
  UNAS_SNAPSHOT_STALE_HOURS_DEGRADED,
  UNAS_SNAPSHOT_STALE_HOURS_UNKNOWN,
} from "./stock-diagnostics.thresholds.js";
import type {
  ActivationReadinessResult,
  DiagnosticStatus,
  LivenessResult,
  MigrationDiagnostics,
  OutboxBacklogDiagnostics,
  ReadinessResult,
  StockDiagnosticsReport,
  UnasConfigDiagnostics,
  UnasSnapshotFreshnessDiagnostics,
} from "./stock-diagnostics.types.js";

/// Precedence when combining several DiagnosticStatus values into one
/// overall status: BLOCKED beats everything, then UNKNOWN, then DEGRADED,
/// then OK. UNKNOWN deliberately ranks above DEGRADED - "we can't tell"
/// must never be silently reported as "we checked and it's just a minor
/// issue".
const STATUS_RANK: Record<DiagnosticStatus, number> = {
  OK: 0,
  DEGRADED: 1,
  UNKNOWN: 2,
  BLOCKED: 3,
};

function worst(...statuses: DiagnosticStatus[]): DiagnosticStatus {
  return statuses.reduce((acc, status) =>
    STATUS_RANK[status] > STATUS_RANK[acc] ? status : acc,
  );
}

/// Read-only health/diagnostics for the inventory/UNAS stock subsystem
/// (checkpoint 6, section 7-9). Every method here is a pure read: no
/// StockItem/StockMovement/UnasStockSyncOutbox row, no repair, no retry, no
/// UNAS setStock call is ever triggered from this class - see this file's
/// own doc comments and docs/INVENTORY-CONSISTENCY.md's "Health és
/// diagnosztika" section for the full rationale.
@Injectable()
export class StockDiagnosticsService {
  constructor(
    private readonly repository: StockDiagnosticsRepository,
    private readonly reconciliation: StockReconciliationService,
    private readonly unasOrderAudit: UnasOrderStockAuditService,
  ) {}

  /// Trivial liveness: the process can respond at all. No dependency is
  /// checked - a liveness probe answering "OK" only because Postgres is
  /// also up would defeat its own purpose (an orchestrator would then never
  /// distinguish "restart me" from "wait for my dependency").
  liveness(): LivenessResult {
    return {
      status: "OK",
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  /// Readiness: only the database and the handful of tables this
  /// subsystem depends on. Public-safe - no counts, no business data, just
  /// booleans/latency.
  async readiness(): Promise<ReadinessResult> {
    const [database, requiredTables] = await Promise.all([
      this.repository.checkDatabase(),
      this.repository.checkRequiredTables(),
    ]);
    const anyTableUnreachable = requiredTables.some((table) => !table.reachable);
    const status: DiagnosticStatus = !database.reachable
      ? "BLOCKED"
      : anyTableUnreachable
        ? "BLOCKED"
        : "OK";
    return { status, database, requiredTables, timestamp: new Date().toISOString() };
  }

  /// Detailed, permission-gated diagnostics report - see this file's
  /// module doc comment for what "read-only" guarantees here.
  async diagnostics(): Promise<StockDiagnosticsReport> {
    const [
      database,
      requiredTables,
      statusCounts,
      oldestPendingAgeSeconds,
      expiredProcessingLeaseCount,
      freshness,
      migrationStatus,
      reconciliationSummary,
      unasOrderAuditSummary,
    ] = await Promise.all([
      this.repository.checkDatabase(),
      this.repository.checkRequiredTables(),
      this.repository.outboxStatusCounts(),
      this.repository.oldestPendingAgeSeconds(),
      this.repository.expiredProcessingLeaseCount(),
      this.repository.unasSnapshotFreshness(),
      this.repository.migrationStatus(),
      this.reconciliation.summarize({}),
      this.unasOrderAudit.summarize(),
    ]);

    const notes: string[] = [];

    const outbox = this.computeOutboxDiagnostics(
      statusCounts,
      oldestPendingAgeSeconds,
      expiredProcessingLeaseCount,
    );
    const unasSnapshotFreshness = this.computeSnapshotFreshness(freshness);
    const migrations = this.computeMigrationDiagnostics(migrationStatus);
    if (!migrations.checked) {
      notes.push(
        "A migrációk állapota nem ellenőrizhető ebben a környezetben (a migrációs mappa vagy az _prisma_migrations tábla nem olvasható) - ez UNKNOWN, nem OK.",
      );
    }

    const reconciliation = {
      checkedCount: reconciliationSummary.checkedCount,
      historicalBaselineUnknownCount: reconciliationSummary.byStatus.HISTORICAL_BASELINE_UNKNOWN,
      invalidLedgerDataCount: reconciliationSummary.byStatus.INVALID_LEDGER_DATA,
      localLedgerMismatchCount: reconciliationSummary.byStatus.LOCAL_LEDGER_MISMATCH,
    };
    if (reconciliation.historicalBaselineUnknownCount > 0) {
      notes.push(
        `${reconciliation.historicalBaselineUnknownCount} StockItem HISTORICAL_BASELINE_UNKNOWN állapotban - ez önmagában NEM teszi az API-t egészségtelenné, csak figyelmeztetés.`,
      );
    }
    const reconciliationStatus: DiagnosticStatus =
      reconciliation.localLedgerMismatchCount >= RECONCILIATION_LOCAL_LEDGER_MISMATCH_COUNT_DEGRADED
        ? "DEGRADED"
        : "OK";

    const unasOrderAuditSnapshot = {
      ordersChecked: unasOrderAuditSummary.ordersChecked,
      ordersWithRiskFlags: unasOrderAuditSummary.ordersWithRiskFlags,
    };
    const unasOrderAuditStatus: DiagnosticStatus =
      unasOrderAuditSnapshot.ordersWithRiskFlags >= UNAS_ORDER_AUDIT_RISK_ORDER_COUNT_DEGRADED
        ? "BLOCKED" // matches section 8: "historical order audit critical risk: BLOCKED for UNAS delta engine production activation" - surfaced here too so the general diagnostics report doesn't understate it.
        : "OK";

    const unasConfig = this.computeUnasConfigDiagnostics();

    const readinessStatus: DiagnosticStatus =
      !database.reachable || requiredTables.some((t) => !t.reachable) ? "BLOCKED" : "OK";

    const status = worst(
      readinessStatus,
      outbox.status,
      unasSnapshotFreshness.status,
      migrations.status,
      reconciliationStatus,
      unasOrderAuditStatus,
    );

    return {
      status,
      checkedAt: new Date().toISOString(),
      database,
      requiredTables,
      outbox,
      unasSnapshotFreshness,
      reconciliation,
      unasOrderAudit: unasOrderAuditSnapshot,
      migrations,
      unasConfig,
      notes,
    };
  }

  /// Section 9's read-only UNAS delta-engine activation-readiness gate.
  /// Builds on the checkpoint-5 UNAS order audit's own
  /// safeToActivateWithoutBackfill/blockingReasons and adds two further,
  /// release-process-level gates that no runtime check can honestly
  /// satisfy on its own: a migration and a Postgres concurrency test.
  async activationReadiness(): Promise<ActivationReadinessResult> {
    const [auditSummary, migrationStatus] = await Promise.all([
      this.unasOrderAudit.summarize(),
      this.repository.migrationStatus(),
    ]);

    const blockingReasons = [...auditSummary.blockingReasons];
    const warnings: string[] = [];

    const migrations = this.computeMigrationDiagnostics(migrationStatus);
    if (migrations.status === "BLOCKED") {
      blockingReasons.push(
        `${migrations.missing.length} migráció nincs alkalmazva: ${migrations.missing.join(", ")}.`,
      );
    } else if (migrations.status === "UNKNOWN") {
      warnings.push(
        "A migrációk alkalmazottsága nem ellenőrizhető ebben a környezetben - ez önmagában nem BLOCKED, de a release-folyamatnak külön kell igazolnia.",
      );
    }

    // This is deliberately, permanently "NOT_DEMONSTRATED" from a runtime
    // health check's perspective: there is no persisted, verifiable record
    // in this codebase today of "the 76d8c80 integration test ran against a
    // real Postgres in THIS release and passed" - a spec FILE existing on
    // disk proves only that the test was WRITTEN, not that it ran. Claiming
    // otherwise here would be exactly the "runtime health and release
    // evidence are two separate things" conflation the checkpoint
    // explicitly warned against (section 9). A future release pipeline
    // could close this gap by writing a signed/timestamped record (e.g. a
    // dedicated small DB table or artifact) that this method then reads -
    // deliberately not built here, since fabricating one now would itself
    // be a false, unearned "yes it ran".
    blockingReasons.push(
      "A rendelésenkénti (unas-order-sync) PostgreSQL advisory lock konkurenciatesztjének (76d8c80) valódi lefutása nincs igazolva ebben a release-folyamatban - lásd checkpoint 6 zárójelentését a pontos futtatási kísérlet eredményéért.",
    );

    return {
      safeToActivate: blockingReasons.length === 0,
      blockingReasons,
      warnings,
      checkedAt: new Date().toISOString(),
      concurrencyTestEvidence: "NOT_DEMONSTRATED",
    };
  }

  private computeOutboxDiagnostics(
    statusCounts: Record<string, number>,
    oldestPendingAgeSeconds: number | null,
    expiredProcessingLeaseCount: number,
  ): OutboxBacklogDiagnostics {
    const pendingCount = statusCounts.PENDING ?? 0;
    const failedCount = statusCounts.FAILED ?? 0;
    const deadLetterCount = statusCounts.DEAD_LETTER ?? 0;
    const processingCount = statusCounts.PROCESSING ?? 0;
    const oldestPendingAgeMinutes =
      oldestPendingAgeSeconds !== null ? oldestPendingAgeSeconds / 60 : null;

    let status: DiagnosticStatus = "OK";
    if (
      pendingCount >= OUTBOX_PENDING_COUNT_BLOCKED ||
      failedCount >= OUTBOX_FAILED_COUNT_BLOCKED ||
      deadLetterCount >= OUTBOX_DEAD_LETTER_COUNT_BLOCKED ||
      expiredProcessingLeaseCount > 0 ||
      (oldestPendingAgeMinutes !== null &&
        oldestPendingAgeMinutes >= OUTBOX_OLDEST_PENDING_AGE_MINUTES_BLOCKED)
    ) {
      status = "BLOCKED";
    } else if (
      pendingCount >= OUTBOX_PENDING_COUNT_DEGRADED ||
      failedCount > 0 ||
      deadLetterCount > 0 ||
      (oldestPendingAgeMinutes !== null &&
        oldestPendingAgeMinutes >= OUTBOX_OLDEST_PENDING_AGE_MINUTES_DEGRADED)
    ) {
      status = "DEGRADED";
    }
    // Expired PROCESSING lease: section 8 allows DEGRADED-or-BLOCKED - this
    // implementation treats it as BLOCKED (a crashed worker holding a stuck
    // lease is not self-healing without the next claim cycle, which itself
    // depends on the scheduler being alive) rather than DEGRADED, since a
    // silent DEGRADED here could be missed while stock genuinely fails to
    // reach UNAS.

    return {
      status,
      pendingCount,
      failedCount,
      deadLetterCount,
      processingCount,
      expiredProcessingLeaseCount,
      oldestPendingAgeSeconds,
    };
  }

  private computeSnapshotFreshness(freshness: {
    productsWithReportedStock: number;
    syncedAts: Array<Date | null>;
  }): UnasSnapshotFreshnessDiagnostics {
    if (freshness.productsWithReportedStock === 0) {
      // No UNAS-linked product with a reported stock value at all - not
      // itself a problem (e.g. a fresh environment before the first UNAS
      // product import), but nothing to assess either.
      return {
        status: "UNKNOWN",
        productsWithReportedStock: 0,
        productsWithUnknownFreshness: 0,
        oldestSyncAgeHours: null,
      };
    }

    const now = Date.now();
    const ages = freshness.syncedAts.map((syncedAt) =>
      syncedAt ? (now - syncedAt.getTime()) / (1000 * 60 * 60) : null,
    );
    const knownAges = ages.filter((age): age is number => age !== null);
    const oldestSyncAgeHours = knownAges.length > 0 ? Math.max(...knownAges) : null;
    const productsWithUnknownFreshness = ages.filter(
      (age) => age === null || age >= UNAS_SNAPSHOT_STALE_HOURS_UNKNOWN,
    ).length;

    let status: DiagnosticStatus = "OK";
    if (productsWithUnknownFreshness > 0) {
      status = "UNKNOWN";
    } else if (
      oldestSyncAgeHours !== null &&
      oldestSyncAgeHours >= UNAS_SNAPSHOT_STALE_HOURS_DEGRADED
    ) {
      status = "DEGRADED";
    }

    return {
      status,
      productsWithReportedStock: freshness.productsWithReportedStock,
      productsWithUnknownFreshness,
      oldestSyncAgeHours,
    };
  }

  private computeMigrationDiagnostics(migrationStatus: {
    checked: boolean;
    expected: string[];
    applied: string[];
  }): MigrationDiagnostics {
    if (!migrationStatus.checked) {
      return {
        status: "UNKNOWN",
        checked: false,
        expectedCount: migrationStatus.expected.length,
        appliedCount: 0,
        missing: [],
      };
    }
    const appliedSet = new Set(migrationStatus.applied);
    const missing = migrationStatus.expected.filter((name) => !appliedSet.has(name));
    return {
      status: missing.length > 0 ? "BLOCKED" : "OK",
      checked: true,
      expectedCount: migrationStatus.expected.length,
      appliedCount: migrationStatus.applied.length,
      missing,
    };
  }

  /// Presence-only - never returns the key/URL value itself, matching
  /// section 7's explicit "without leaking secrets in the response".
  private computeUnasConfigDiagnostics(): UnasConfigDiagnostics {
    return {
      apiKeyConfigured: Boolean(process.env.UNAS_API_KEY?.trim()),
      apiUrlIsDefault: !process.env.UNAS_API_URL?.trim(),
    };
  }
}
