import { Injectable } from "@nestjs/common";

import { currentReleaseCommitSha } from "../common/release-info.util.js";
import { StockReconciliationService } from "../inventory/stock-reconciliation.service.js";
import { UnasOrderStockAuditService } from "../orders/unas-order-sync/unas-order-stock-audit.service.js";
import { StockDiagnosticsRepository } from "./stock-diagnostics.repository.js";
import {
  EXPECTED_RELEASE_EVIDENCE_REPOSITORY,
  OUTBOX_DEAD_LETTER_COUNT_BLOCKED,
  OUTBOX_FAILED_COUNT_BLOCKED,
  OUTBOX_OLDEST_PENDING_AGE_MINUTES_BLOCKED,
  OUTBOX_OLDEST_PENDING_AGE_MINUTES_DEGRADED,
  OUTBOX_PENDING_COUNT_BLOCKED,
  OUTBOX_PENDING_COUNT_DEGRADED,
  RECONCILIATION_LOCAL_LEDGER_MISMATCH_COUNT_DEGRADED,
  RELEASE_EVIDENCE_MAX_AGE_DAYS,
  REQUIRED_DATABASE_ENGINE,
  REQUIRED_DATABASE_ENGINE_MAJOR_VERSION_PREFIX,
  TRUSTED_RELEASE_EVIDENCE_TRIGGER_EVENTS,
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

  /// Section 9's (checkpoint 6) / section 7's (checkpoint 7) read-only
  /// UNAS delta-engine activation-readiness gate. Builds on the
  /// checkpoint-5 UNAS order audit's own safeToActivateWithoutBackfill/
  /// blockingReasons, a migration-applied check, and now (checkpoint 7) a
  /// genuine ReleaseEvidence lookup - see
  /// packages/database/prisma/record-release-evidence.ts and
  /// schema.prisma's ReleaseEvidence doc comment for how a row can ever
  /// come to exist at all (never through this API, never through any
  /// admin action - only a real CI/release process holding a real
  /// DATABASE_URL can write one).
  ///
  /// The "most important rule" (checkpoint 7's own framing): neither the
  /// existence of test CODE nor a manually-set flag proves PostgreSQL
  /// concurrency safety. This method enforces that by requiring ALL of:
  /// the running build to know its own commit (RELEASE_COMMIT_SHA set);
  /// a ReleaseEvidence row with status SUCCESS; that row's commitSha to
  /// match the running commit EXACTLY (an old commit's SUCCESS must never
  /// silently unblock a new, different release - a bug fixed in commit N
  /// could easily be a regression reintroduced in commit N+5, and nothing
  /// about "some earlier commit once passed" says anything about N+5);
  /// and that row not to be implausibly old even for a matching commit.
  async activationReadiness(): Promise<ActivationReadinessResult> {
    const evaluatedCommitSha = currentReleaseCommitSha();
    const [auditSummary, migrationStatus, evidence] = await Promise.all([
      this.unasOrderAudit.summarize(),
      this.repository.migrationStatus(),
      evaluatedCommitSha
        ? this.repository.findLatestConcurrencyTestEvidence(evaluatedCommitSha)
        : Promise.resolve(null),
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

    let concurrencyTestEvidence: ActivationReadinessResult["concurrencyTestEvidence"];
    if (!evaluatedCommitSha) {
      concurrencyTestEvidence = "NOT_CONFIGURED";
      blockingReasons.push(
        "A futó build nem ismeri a saját commit SHA-ját (RELEASE_COMMIT_SHA nincs beállítva), ezért semmilyen release evidence nem köthető hozzá.",
      );
    } else if (!evidence) {
      concurrencyTestEvidence = "NOT_DEMONSTRATED";
      blockingReasons.push(
        `A PostgreSQL advisory-lock konkurenciateszt (INVENTORY_POSTGRES_CONCURRENCY_TEST) SUCCESS bizonyítéka nem található a jelenlegi commitra (${evaluatedCommitSha}). Régebbi commitra futott siker NEM oldja fel ezt a blokkolást - lásd record-release-evidence.ts.`,
      );
    } else {
      const ageDays = (Date.now() - evidence.completedAt.getTime()) / (1000 * 60 * 60 * 24);
      // Checkpoint 8: an exact-commit SUCCESS row that isn't too old is
      // STILL not automatically sufficient - the "most important rule"
      // (the user's own framing for this checkpoint) is that a raw
      // advisory-lock primitive proof is not application-level proof, and
      // only a genuine, identifiable, PostgreSQL-16, GitHub-Actions-
      // originated CI/release run may lift this gate. Each authenticity
      // violation below is reported as its own distinct blocking reason,
      // rather than a single generic "invalid evidence" message, so a
      // future release/deploy engineer can see exactly which property
      // failed instead of having to guess.
      const authenticityViolations: string[] = [];

      if (ageDays > RELEASE_EVIDENCE_MAX_AGE_DAYS) {
        authenticityViolations.push(
          `A jelenlegi commitra (${evaluatedCommitSha}) talált SUCCESS evidence túl régi (${Math.round(ageDays)} nap) - lásd RELEASE_EVIDENCE_MAX_AGE_DAYS.`,
        );
      }
      if (!evidence.workflowRunId.trim()) {
        authenticityViolations.push(
          "A talált evidence sornak nincs workflowRunId-ja - nem vezethető vissza egy konkrét, ellenőrizhető CI-futásra.",
        );
      }
      if (evidence.repository !== EXPECTED_RELEASE_EVIDENCE_REPOSITORY) {
        authenticityViolations.push(
          `A talált evidence sor egy másik repositoryból származik ("${evidence.repository}", elvárt: "${EXPECTED_RELEASE_EVIDENCE_REPOSITORY}") - még egy véletlenül egyező commitSha esetén sem fogadható el.`,
        );
      }
      if (!TRUSTED_RELEASE_EVIDENCE_TRIGGER_EVENTS.has(evidence.triggerEvent)) {
        authenticityViolations.push(
          `A talált evidence sor nem megbízható GitHub Actions eseményből származik ("${evidence.triggerEvent}") - egy pull_request (különösen egy fork pull_requestje) sosem elég a production activation-readiness feloldásához, lásd TRUSTED_RELEASE_EVIDENCE_TRIGGER_EVENTS.`,
        );
      }
      if (
        evidence.databaseEngine !== REQUIRED_DATABASE_ENGINE ||
        !evidence.databaseEngineVersion.startsWith(REQUIRED_DATABASE_ENGINE_MAJOR_VERSION_PREFIX)
      ) {
        authenticityViolations.push(
          `A talált evidence sor nem PostgreSQL ${REQUIRED_DATABASE_ENGINE_MAJOR_VERSION_PREFIX}-on futott (${evidence.databaseEngine} ${evidence.databaseEngineVersion}) - a production postgres:16-alpine-ot futtat, egy másik főverzión (pl. a checkpoint 7 kiegészítő PostgreSQL 18.4 futása) lefutott teszt önmagában nem elég.`,
        );
      }

      if (authenticityViolations.length > 0) {
        concurrencyTestEvidence = "NOT_DEMONSTRATED";
        blockingReasons.push(...authenticityViolations);
      } else {
        concurrencyTestEvidence = "DEMONSTRATED";
      }
    }

    return {
      safeToActivate: blockingReasons.length === 0,
      blockingReasons,
      warnings,
      checkedAt: new Date().toISOString(),
      evaluatedCommitSha,
      concurrencyTestEvidence,
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
