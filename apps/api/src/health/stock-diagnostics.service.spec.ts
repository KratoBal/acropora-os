import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import type { StockReconciliationService } from "../inventory/stock-reconciliation.service.js";
import type { UnasOrderStockAuditService } from "../orders/unas-order-sync/unas-order-stock-audit.service.js";
import {
  StockDiagnosticsRepository,
  type StockDiagnosticsDatabase,
} from "./stock-diagnostics.repository.js";
import { StockDiagnosticsService } from "./stock-diagnostics.service.js";

const BASE_RECONCILIATION_SUMMARY = {
  checkedAt: new Date().toISOString(),
  checkedCount: 0,
  byStatus: {
    CONSISTENT: 0,
    LOCAL_LEDGER_MISMATCH: 0,
    UNAS_BEHIND_PENDING_SYNC: 0,
    UNAS_MISMATCH_NO_PENDING_SYNC: 0,
    SYNC_FAILED: 0,
    PROCESSING_LEASE_EXPIRED: 0,
    MISSING_STOCK_ITEM: 0,
    MISSING_UNAS_LINK: 0,
    HISTORICAL_BASELINE_UNKNOWN: 0,
    INVALID_LEDGER_DATA: 0,
  },
};

const BASE_AUDIT_SUMMARY = {
  checkedAt: new Date().toISOString(),
  ordersChecked: 0,
  ordersWithRiskFlags: 0,
  riskFlagCounts: {
    MISSING_EXTERNAL_REFERENCE: 0,
    DUPLICATE_UNAS_KEY: 0,
    ACTIVE_ORDER_ZERO_BOOKED: 0,
    CANCELLED_ORDER_POSITIVE_BOOKED: 0,
    NEGATIVE_BOOKED_QUANTITY: 0,
  },
  duplicateUnasKeyCount: 0,
  orphanStockMovementReferenceCount: 0,
  safeToActivateWithoutBackfill: true,
  blockingReasons: [] as string[],
};

/// Mirrors stock-diagnostics.repository.ts::migrationsDir() exactly (same
/// relative path from this file's own directory) so the fixture's default
/// "fully migrated, healthy" state tracks the real, on-disk migration
/// folder instead of drifting out of sync with it (and so this list never
/// has to be hand-maintained/hard-coded here).
function realMigrationNames(): string[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const migrationsDir = path.resolve(
    here,
    "../../../../packages/database/prisma/migrations",
  );
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

class FakeDiagnosticsDb {
  dbReachable = true;
  outboxCounts: Record<string, number> = {};
  oldestPendingAgeSeconds: number | null = null;
  expiredLeaseCount = 0;
  snapshotRows: Array<{
    reportedStock: unknown;
    reportedStockSyncedAt: Date | null;
  }> = [];
  migrationsChecked = true;
  // Default to "everything on disk is applied" - the healthy-by-default
  // state every test in this suite other than a migrations-specific one
  // implicitly relies on. Previously these two fields were never actually
  // wired into $queryRaw below, so migrationStatus() always saw 0 applied
  // migrations against the real on-disk folder and every diagnostics()
  // call in this file was silently BLOCKED by a false migrations gate,
  // masking whatever the individual test actually meant to exercise.
  expectedMigrations: string[] = realMigrationNames();
  appliedMigrations: string[] = realMigrationNames();

  async $queryRaw() {
    if (!this.dbReachable) throw new Error("connection refused");
    if (!this.migrationsChecked)
      throw new Error("_prisma_migrations not readable");
    return this.appliedMigrations.map((name) => ({
      migration_name: name,
    })) as unknown;
  }

  stockItem = { count: async () => 0 };
  stockMovement = { count: async () => 0 };
  salesOrder = { count: async () => 0 };

  unasStockSyncOutbox = {
    count: async (args?: {
      where?: { status?: string; leaseExpiresAt?: unknown };
    }) => {
      if (args?.where?.status === "PROCESSING") return this.expiredLeaseCount;
      return 0;
    },
    groupBy: async () =>
      Object.entries(this.outboxCounts).map(([status, count]) => ({
        status,
        _count: { _all: count },
      })),
    findFirst: async () =>
      this.oldestPendingAgeSeconds !== null
        ? {
            createdAt: new Date(
              Date.now() - this.oldestPendingAgeSeconds * 1000,
            ),
          }
        : null,
  };

  unasProductSnapshot = {
    count: async () => this.snapshotRows.length,
    findMany: async () => this.snapshotRows,
  };

  releaseEvidenceRow: {
    id: string;
    commitSha: string;
    workflowRunId: string;
    repository: string;
    workflowName: string;
    jobName: string;
    triggerEvent: string;
    environment: string;
    databaseEngine: string;
    databaseEngineVersion: string;
    testSuite: string;
    createdAt: Date;
    completedAt: Date;
  } | null = null;

  // Checkpoint 9: a second, independent fixture for the contradicting-
  // FAILURE lookup (findContradictingFailureForWorkflowRun) - kept
  // separate from releaseEvidenceRow so a test can set up a SUCCESS row
  // and a contradicting FAILURE row for the SAME workflowRunId without
  // the two overwriting each other.
  contradictingFailureRow: {
    id: string;
    status: string;
    createdAt: Date;
  } | null = null;

  releaseEvidence = {
    findFirst: async (args: {
      where: { commitSha?: string; workflowRunId?: string; status?: string };
    }) => {
      // The contradiction-check query (workflowRunId + status: FAILURE,
      // no commitSha) is dispatched separately from the exact-commit
      // SUCCESS lookup (commitSha + status: SUCCESS, no workflowRunId) -
      // this fake distinguishes them the same way the real Prisma query
      // does, by which where-clause fields are actually present.
      if (
        args.where.workflowRunId !== undefined &&
        args.where.commitSha === undefined
      ) {
        return this.contradictingFailureRow &&
          this.contradictingFailureRow.status === "FAILURE"
          ? this.contradictingFailureRow
          : null;
      }
      return this.releaseEvidenceRow &&
        this.releaseEvidenceRow.commitSha === args.where.commitSha
        ? this.releaseEvidenceRow
        : null;
    },
  };
}

/// A fully-authentic, checkpoint-8-shaped ReleaseEvidence fixture - every
/// test that wants a genuinely DEMONSTRATED result starts from this and
/// overrides only the ONE field it means to test, so a test asserting
/// "foreign repository blocks the gate" can't accidentally also be
/// (silently) exercising "wrong database engine blocks the gate".
function authenticEvidenceFixture(overrides: {
  commitSha: string;
  createdAt?: Date;
  completedAt?: Date;
  repository?: string;
  triggerEvent?: string;
  databaseEngine?: string;
  databaseEngineVersion?: string;
  workflowRunId?: string;
  testSuite?: string;
}) {
  const now = new Date();
  return {
    id: "evidence-fixture",
    commitSha: overrides.commitSha,
    workflowRunId: overrides.workflowRunId ?? "12345",
    repository: overrides.repository ?? "KratoBal/acropora-os",
    workflowName: "CI",
    jobName: "verify",
    triggerEvent: overrides.triggerEvent ?? "push",
    environment: "github-actions-ci",
    databaseEngine: overrides.databaseEngine ?? "postgres",
    databaseEngineVersion: overrides.databaseEngineVersion ?? "16-alpine",
    testSuite:
      overrides.testSuite ??
      "apps/api test:integration (unas-order-sync.repository.integration.spec.ts)",
    createdAt: overrides.createdAt ?? now,
    completedAt: overrides.completedAt ?? now,
  };
}

function buildService(
  db: FakeDiagnosticsDb,
  options?: {
    reconciliationSummary?: typeof BASE_RECONCILIATION_SUMMARY;
    auditSummary?: typeof BASE_AUDIT_SUMMARY;
  },
) {
  const repository = new StockDiagnosticsRepository(
    db as unknown as StockDiagnosticsDatabase,
  );
  const reconciliation = {
    summarize: async () =>
      options?.reconciliationSummary ?? BASE_RECONCILIATION_SUMMARY,
  } as unknown as StockReconciliationService;
  const unasOrderAudit = {
    summarize: async () => options?.auditSummary ?? BASE_AUDIT_SUMMARY,
  } as unknown as UnasOrderStockAuditService;
  return new StockDiagnosticsService(
    repository,
    reconciliation,
    unasOrderAudit,
  );
}

describe("StockDiagnosticsService.readiness", () => {
  it("is BLOCKED when the database is unreachable", async () => {
    const db = new FakeDiagnosticsDb();
    db.dbReachable = false;
    const service = buildService(db);
    const result = await service.readiness();
    assert.equal(result.status, "BLOCKED");
    assert.equal(result.database.reachable, false);
  });

  it("is OK when the database and required tables are reachable", async () => {
    const db = new FakeDiagnosticsDb();
    const service = buildService(db);
    const result = await service.readiness();
    assert.equal(result.status, "OK");
    assert.ok(result.requiredTables.every((table) => table.reachable));
  });
});

describe("StockDiagnosticsService.diagnostics - outbox backlog", () => {
  it("a small PENDING backlog is OK, not a false error", async () => {
    const db = new FakeDiagnosticsDb();
    db.outboxCounts = { PENDING: 3 };
    db.oldestPendingAgeSeconds = 60; // 1 minute - well under the "degraded" threshold
    const service = buildService(db);
    const report = await service.diagnostics();
    assert.equal(report.outbox.status, "OK");
  });

  it("detects a FAILED row as at least DEGRADED", async () => {
    const db = new FakeDiagnosticsDb();
    db.outboxCounts = { FAILED: 1 };
    const service = buildService(db);
    const report = await service.diagnostics();
    assert.notEqual(report.outbox.status, "OK");
  });

  it("detects an expired PROCESSING lease as BLOCKED", async () => {
    const db = new FakeDiagnosticsDb();
    db.outboxCounts = { PROCESSING: 1 };
    db.expiredLeaseCount = 1;
    const service = buildService(db);
    const report = await service.diagnostics();
    assert.equal(report.outbox.status, "BLOCKED");
    assert.equal(report.outbox.expiredProcessingLeaseCount, 1);
  });

  it("a large PENDING backlog past the BLOCKED threshold is BLOCKED", async () => {
    const db = new FakeDiagnosticsDb();
    db.outboxCounts = { PENDING: 1000 };
    const service = buildService(db);
    const report = await service.diagnostics();
    assert.equal(report.outbox.status, "BLOCKED");
  });
});

describe("StockDiagnosticsService.diagnostics - UNAS snapshot freshness", () => {
  it("is UNKNOWN when there are no UNAS-linked products with reported stock at all", async () => {
    const db = new FakeDiagnosticsDb();
    db.snapshotRows = [];
    const service = buildService(db);
    const report = await service.diagnostics();
    assert.equal(report.unasSnapshotFreshness.status, "UNKNOWN");
  });

  it("is OK when the freshest sync is recent", async () => {
    const db = new FakeDiagnosticsDb();
    db.snapshotRows = [{ reportedStock: 5, reportedStockSyncedAt: new Date() }];
    const service = buildService(db);
    const report = await service.diagnostics();
    assert.equal(report.unasSnapshotFreshness.status, "OK");
  });

  it("is DEGRADED when the oldest sync crosses the staleness threshold", async () => {
    const db = new FakeDiagnosticsDb();
    db.snapshotRows = [
      {
        reportedStock: 5,
        reportedStockSyncedAt: new Date(Date.now() - 30 * 60 * 60 * 1000),
      }, // 30h ago
    ];
    const service = buildService(db);
    const report = await service.diagnostics();
    assert.equal(report.unasSnapshotFreshness.status, "DEGRADED");
  });
});

describe("StockDiagnosticsService.diagnostics - historical order audit anomalies", () => {
  it("BLOCKED when the UNAS order audit reports risk-flagged orders", async () => {
    const db = new FakeDiagnosticsDb();
    const service = buildService(db, {
      auditSummary: {
        ...BASE_AUDIT_SUMMARY,
        ordersChecked: 10,
        ordersWithRiskFlags: 2,
        safeToActivateWithoutBackfill: false,
        blockingReasons: ["2 rendelésen van legalább egy kockázati jelző."],
      },
    });
    const report = await service.diagnostics();
    assert.equal(report.status, "BLOCKED");
  });

  it("HISTORICAL_BASELINE_UNKNOWN StockItems alone do not block the whole report", async () => {
    const db = new FakeDiagnosticsDb();
    const service = buildService(db, {
      reconciliationSummary: {
        ...BASE_RECONCILIATION_SUMMARY,
        checkedCount: 5,
        byStatus: {
          ...BASE_RECONCILIATION_SUMMARY.byStatus,
          HISTORICAL_BASELINE_UNKNOWN: 5,
        },
      },
    });
    const report = await service.diagnostics();
    assert.notEqual(report.status, "BLOCKED");
    assert.ok(
      report.notes.some((note) => note.includes("HISTORICAL_BASELINE_UNKNOWN")),
    );
  });
});

describe("StockDiagnosticsService - no secrets, no mutation", () => {
  it("UNAS config diagnostics never includes the actual API key/URL value", async () => {
    const originalKey = process.env.UNAS_API_KEY;
    process.env.UNAS_API_KEY = "super-secret-value";
    try {
      const db = new FakeDiagnosticsDb();
      const service = buildService(db);
      const report = await service.diagnostics();
      const serialized = JSON.stringify(report);
      assert.equal(report.unasConfig.apiKeyConfigured, true);
      assert.ok(!serialized.includes("super-secret-value"));
    } finally {
      if (originalKey === undefined) delete process.env.UNAS_API_KEY;
      else process.env.UNAS_API_KEY = originalKey;
    }
  });

  it("the FakeDb this suite drives exposes no create/update/delete method anywhere - structurally proving diagnostics() cannot mutate", () => {
    const db = new FakeDiagnosticsDb();
    const methodsByModel: Record<string, string[]> = {
      stockItem: Object.keys(db.stockItem),
      stockMovement: Object.keys(db.stockMovement),
      salesOrder: Object.keys(db.salesOrder),
      unasStockSyncOutbox: Object.keys(db.unasStockSyncOutbox),
      unasProductSnapshot: Object.keys(db.unasProductSnapshot),
      releaseEvidence: Object.keys(db.releaseEvidence),
    };
    const allowed = new Set(["count", "groupBy", "findFirst", "findMany"]);
    for (const [modelName, methodNames] of Object.entries(methodsByModel)) {
      for (const methodName of methodNames) {
        assert.ok(
          allowed.has(methodName),
          `unexpected mutating-looking method ${modelName}.${methodName}`,
        );
      }
    }
  });
});

async function withReleaseCommitSha(
  sha: string | undefined,
  run: () => Promise<void>,
) {
  const original = process.env.RELEASE_COMMIT_SHA;
  if (sha === undefined) delete process.env.RELEASE_COMMIT_SHA;
  else process.env.RELEASE_COMMIT_SHA = sha;
  try {
    await run();
  } finally {
    if (original === undefined) delete process.env.RELEASE_COMMIT_SHA;
    else process.env.RELEASE_COMMIT_SHA = original;
  }
}

describe("StockDiagnosticsService.activationReadiness", () => {
  it("is NOT_CONFIGURED when the running build doesn't know its own commit (RELEASE_COMMIT_SHA unset)", async () => {
    await withReleaseCommitSha(undefined, async () => {
      const db = new FakeDiagnosticsDb();
      const service = buildService(db);
      const result = await service.activationReadiness();
      assert.equal(result.safeToActivate, false);
      assert.equal(result.concurrencyTestEvidence, "NOT_CONFIGURED");
      assert.equal(result.evaluatedCommitSha, null);
    });
  });

  it("is NOT_DEMONSTRATED when the commit is known but no ReleaseEvidence row exists for it", async () => {
    await withReleaseCommitSha(
      "4444444444444444444444444444444444444444",
      async () => {
        const db = new FakeDiagnosticsDb();
        const service = buildService(db);
        const result = await service.activationReadiness();
        assert.equal(result.safeToActivate, false);
        assert.equal(result.concurrencyTestEvidence, "NOT_DEMONSTRATED");
        assert.equal(
          result.evaluatedCommitSha,
          "4444444444444444444444444444444444444444",
        );
        assert.ok(
          result.blockingReasons.some((reason) =>
            reason.includes("INVENTORY_POSTGRES_CONCURRENCY_TEST"),
          ),
        );
      },
    );
  });

  it("a SUCCESS evidence row for an OLDER, DIFFERENT commit does not satisfy the current commit's gate", async () => {
    await withReleaseCommitSha(
      "3333333333333333333333333333333333333333",
      async () => {
        const db = new FakeDiagnosticsDb();
        db.releaseEvidenceRow = authenticEvidenceFixture({
          commitSha: "2222222222222222222222222222222222222222",
        });
        const service = buildService(db);
        const result = await service.activationReadiness();
        assert.equal(result.concurrencyTestEvidence, "NOT_DEMONSTRATED");
        assert.equal(result.safeToActivate, false);
      },
    );
  });

  it("is DEMONSTRATED when a fresh, fully-authentic SUCCESS row matches the exact current commit", async () => {
    await withReleaseCommitSha(
      "1111111111111111111111111111111111111111",
      async () => {
        const db = new FakeDiagnosticsDb();
        db.releaseEvidenceRow = authenticEvidenceFixture({
          commitSha: "1111111111111111111111111111111111111111",
        });
        const service = buildService(db);
        const result = await service.activationReadiness();
        assert.equal(result.concurrencyTestEvidence, "DEMONSTRATED");
        assert.equal(result.safeToActivate, true);
      },
    );
  });

  it("an implausibly old SUCCESS row for the exact current commit still does not satisfy the gate", async () => {
    await withReleaseCommitSha(
      "1111111111111111111111111111111111111111",
      async () => {
        const db = new FakeDiagnosticsDb();
        const veryOld = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000); // 400 days ago
        db.releaseEvidenceRow = authenticEvidenceFixture({
          commitSha: "1111111111111111111111111111111111111111",
          createdAt: veryOld,
          completedAt: veryOld,
        });
        const service = buildService(db);
        const result = await service.activationReadiness();
        assert.equal(result.concurrencyTestEvidence, "NOT_DEMONSTRATED");
        assert.equal(result.safeToActivate, false);
      },
    );
  });

  // --- Checkpoint 8: the raw advisory-lock primitive is not application-
  // level proof, and only a genuine PostgreSQL-16, GitHub-Actions-
  // originated CI/release run may lift this gate - see
  // stock-diagnostics.service.ts::activationReadiness's own comment and
  // stock-diagnostics.thresholds.ts's EXPECTED_RELEASE_EVIDENCE_REPOSITORY/
  // TRUSTED_RELEASE_EVIDENCE_TRIGGER_EVENTS/REQUIRED_DATABASE_ENGINE*.

  it("a SUCCESS row from a foreign repository does not satisfy the gate, even with a matching commitSha", async () => {
    await withReleaseCommitSha(
      "1111111111111111111111111111111111111111",
      async () => {
        const db = new FakeDiagnosticsDb();
        db.releaseEvidenceRow = authenticEvidenceFixture({
          commitSha: "1111111111111111111111111111111111111111",
          repository: "someone-else/acropora-os-fork",
        });
        const service = buildService(db);
        const result = await service.activationReadiness();
        assert.equal(result.concurrencyTestEvidence, "NOT_DEMONSTRATED");
        assert.equal(result.safeToActivate, false);
        assert.ok(
          result.blockingReasons.some((reason) =>
            reason.includes("másik repositoryból"),
          ),
        );
      },
    );
  });

  it("a SUCCESS row recorded from a pull_request trigger event does not satisfy the gate", async () => {
    await withReleaseCommitSha(
      "1111111111111111111111111111111111111111",
      async () => {
        const db = new FakeDiagnosticsDb();
        db.releaseEvidenceRow = authenticEvidenceFixture({
          commitSha: "1111111111111111111111111111111111111111",
          triggerEvent: "pull_request",
        });
        const service = buildService(db);
        const result = await service.activationReadiness();
        assert.equal(result.concurrencyTestEvidence, "NOT_DEMONSTRATED");
        assert.equal(result.safeToActivate, false);
        assert.ok(
          result.blockingReasons.some((reason) =>
            reason.includes("pull_request"),
          ),
        );
      },
    );
  });

  it("a SUCCESS row recorded against PostgreSQL 18 (not 16) does not satisfy the gate", async () => {
    await withReleaseCommitSha(
      "1111111111111111111111111111111111111111",
      async () => {
        const db = new FakeDiagnosticsDb();
        db.releaseEvidenceRow = authenticEvidenceFixture({
          commitSha: "1111111111111111111111111111111111111111",
          databaseEngineVersion: "18.4",
        });
        const service = buildService(db);
        const result = await service.activationReadiness();
        assert.equal(result.concurrencyTestEvidence, "NOT_DEMONSTRATED");
        assert.equal(result.safeToActivate, false);
        assert.ok(
          result.blockingReasons.some((reason) =>
            reason.includes("PostgreSQL 16"),
          ),
        );
      },
    );
  });

  it("a SUCCESS row with an empty workflowRunId does not satisfy the gate", async () => {
    await withReleaseCommitSha(
      "1111111111111111111111111111111111111111",
      async () => {
        const db = new FakeDiagnosticsDb();
        db.releaseEvidenceRow = authenticEvidenceFixture({
          commitSha: "1111111111111111111111111111111111111111",
          workflowRunId: "",
        });
        const service = buildService(db);
        const result = await service.activationReadiness();
        assert.equal(result.concurrencyTestEvidence, "NOT_DEMONSTRATED");
        assert.equal(result.safeToActivate, false);
        assert.ok(
          result.blockingReasons.some((reason) =>
            reason.includes("workflowRunId"),
          ),
        );
      },
    );
  });

  // --- Checkpoint 9 additions.

  it("a SUCCESS row whose testSuite does not identify the expected test does not satisfy the gate", async () => {
    await withReleaseCommitSha(
      "1111111111111111111111111111111111111111",
      async () => {
        const db = new FakeDiagnosticsDb();
        db.releaseEvidenceRow = authenticEvidenceFixture({
          commitSha: "1111111111111111111111111111111111111111",
          testSuite: "apps/api test (some unrelated suite)",
        });
        const service = buildService(db);
        const result = await service.activationReadiness();
        assert.equal(result.concurrencyTestEvidence, "NOT_DEMONSTRATED");
        assert.equal(result.safeToActivate, false);
        assert.ok(
          result.blockingReasons.some((reason) => reason.includes("testSuite")),
        );
      },
    );
  });

  it("a SUCCESS row contradicted by a FAILURE row for the SAME workflowRunId does not satisfy the gate", async () => {
    await withReleaseCommitSha(
      "1111111111111111111111111111111111111111",
      async () => {
        const db = new FakeDiagnosticsDb();
        db.releaseEvidenceRow = authenticEvidenceFixture({
          commitSha: "1111111111111111111111111111111111111111",
          workflowRunId: "run-42",
        });
        db.contradictingFailureRow = {
          id: "evidence-failure-42",
          status: "FAILURE",
          createdAt: new Date(),
        };
        const service = buildService(db);
        const result = await service.activationReadiness();
        assert.equal(result.concurrencyTestEvidence, "NOT_DEMONSTRATED");
        assert.equal(result.safeToActivate, false);
        assert.ok(
          result.blockingReasons.some((reason) =>
            reason.includes("Ellentmondó evidence"),
          ),
        );
      },
    );
  });

  it("a SUCCESS row with NO contradicting FAILURE for its own workflowRunId is unaffected", async () => {
    await withReleaseCommitSha(
      "1111111111111111111111111111111111111111",
      async () => {
        const db = new FakeDiagnosticsDb();
        db.releaseEvidenceRow = authenticEvidenceFixture({
          commitSha: "1111111111111111111111111111111111111111",
          workflowRunId: "run-99",
        });
        db.contradictingFailureRow = null;
        const service = buildService(db);
        const result = await service.activationReadiness();
        assert.equal(result.concurrencyTestEvidence, "DEMONSTRATED");
        assert.equal(result.safeToActivate, true);
      },
    );
  });

  it("folds in the UNAS order audit's own blocking reasons", async () => {
    const db = new FakeDiagnosticsDb();
    const service = buildService(db, {
      auditSummary: {
        ...BASE_AUDIT_SUMMARY,
        safeToActivateWithoutBackfill: false,
        blockingReasons: ["egy rendelésen negatív bookedOut van"],
      },
    });
    const result = await service.activationReadiness();
    assert.ok(
      result.blockingReasons.includes("egy rendelésen negatív bookedOut van"),
    );
  });
});
