import assert from "node:assert/strict";
import { describe, it } from "node:test";

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

class FakeDiagnosticsDb {
  dbReachable = true;
  outboxCounts: Record<string, number> = {};
  oldestPendingAgeSeconds: number | null = null;
  expiredLeaseCount = 0;
  snapshotRows: Array<{ reportedStock: unknown; reportedStockSyncedAt: Date | null }> = [];
  migrationsChecked = true;
  expectedMigrations: string[] = [];
  appliedMigrations: string[] = [];

  async $queryRaw() {
    if (!this.dbReachable) throw new Error("connection refused");
    return [] as unknown;
  }

  stockItem = { count: async () => 0 };
  stockMovement = { count: async () => 0 };
  salesOrder = { count: async () => 0 };

  unasStockSyncOutbox = {
    count: async (args?: { where?: { status?: string; leaseExpiresAt?: unknown } }) => {
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
        ? { createdAt: new Date(Date.now() - this.oldestPendingAgeSeconds * 1000) }
        : null,
  };

  unasProductSnapshot = {
    count: async () => this.snapshotRows.length,
    findMany: async () => this.snapshotRows,
  };

  releaseEvidenceRow: { id: string; commitSha: string; createdAt: Date; completedAt: Date } | null =
    null;

  releaseEvidence = {
    findFirst: async (args: { where: { commitSha: string } }) =>
      this.releaseEvidenceRow && this.releaseEvidenceRow.commitSha === args.where.commitSha
        ? this.releaseEvidenceRow
        : null,
  };
}

function buildService(db: FakeDiagnosticsDb, options?: {
  reconciliationSummary?: typeof BASE_RECONCILIATION_SUMMARY;
  auditSummary?: typeof BASE_AUDIT_SUMMARY;
}) {
  const repository = new StockDiagnosticsRepository(
    db as unknown as StockDiagnosticsDatabase,
  );
  const reconciliation = {
    summarize: async () => options?.reconciliationSummary ?? BASE_RECONCILIATION_SUMMARY,
  } as unknown as StockReconciliationService;
  const unasOrderAudit = {
    summarize: async () => options?.auditSummary ?? BASE_AUDIT_SUMMARY,
  } as unknown as UnasOrderStockAuditService;
  return new StockDiagnosticsService(repository, reconciliation, unasOrderAudit);
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
      { reportedStock: 5, reportedStockSyncedAt: new Date(Date.now() - 30 * 60 * 60 * 1000) }, // 30h ago
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
        byStatus: { ...BASE_RECONCILIATION_SUMMARY.byStatus, HISTORICAL_BASELINE_UNKNOWN: 5 },
      },
    });
    const report = await service.diagnostics();
    assert.notEqual(report.status, "BLOCKED");
    assert.ok(report.notes.some((note) => note.includes("HISTORICAL_BASELINE_UNKNOWN")));
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
        assert.ok(allowed.has(methodName), `unexpected mutating-looking method ${modelName}.${methodName}`);
      }
    }
  });
});

async function withReleaseCommitSha(sha: string | undefined, run: () => Promise<void>) {
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
    await withReleaseCommitSha("commit-abc", async () => {
      const db = new FakeDiagnosticsDb();
      const service = buildService(db);
      const result = await service.activationReadiness();
      assert.equal(result.safeToActivate, false);
      assert.equal(result.concurrencyTestEvidence, "NOT_DEMONSTRATED");
      assert.equal(result.evaluatedCommitSha, "commit-abc");
      assert.ok(result.blockingReasons.some((reason) => reason.includes("INVENTORY_POSTGRES_CONCURRENCY_TEST")));
    });
  });

  it("a SUCCESS evidence row for an OLDER, DIFFERENT commit does not satisfy the current commit's gate", async () => {
    await withReleaseCommitSha("commit-new", async () => {
      const db = new FakeDiagnosticsDb();
      db.releaseEvidenceRow = {
        id: "evidence-1",
        commitSha: "commit-old",
        createdAt: new Date(),
        completedAt: new Date(),
      };
      const service = buildService(db);
      const result = await service.activationReadiness();
      assert.equal(result.concurrencyTestEvidence, "NOT_DEMONSTRATED");
      assert.equal(result.safeToActivate, false);
    });
  });

  it("is DEMONSTRATED when a fresh SUCCESS row matches the exact current commit", async () => {
    await withReleaseCommitSha("commit-current", async () => {
      const db = new FakeDiagnosticsDb();
      db.releaseEvidenceRow = {
        id: "evidence-2",
        commitSha: "commit-current",
        createdAt: new Date(),
        completedAt: new Date(),
      };
      const service = buildService(db);
      const result = await service.activationReadiness();
      assert.equal(result.concurrencyTestEvidence, "DEMONSTRATED");
      assert.equal(result.safeToActivate, true);
    });
  });

  it("an implausibly old SUCCESS row for the exact current commit still does not satisfy the gate", async () => {
    await withReleaseCommitSha("commit-current", async () => {
      const db = new FakeDiagnosticsDb();
      const veryOld = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000); // 400 days ago
      db.releaseEvidenceRow = {
        id: "evidence-3",
        commitSha: "commit-current",
        createdAt: veryOld,
        completedAt: veryOld,
      };
      const service = buildService(db);
      const result = await service.activationReadiness();
      assert.equal(result.concurrencyTestEvidence, "NOT_DEMONSTRATED");
      assert.equal(result.safeToActivate, false);
    });
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
    assert.ok(result.blockingReasons.includes("egy rendelésen negatív bookedOut van"));
  });
});
