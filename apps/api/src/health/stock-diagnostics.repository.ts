import { Inject, Injectable, Optional } from "@nestjs/common";
import { prisma } from "@acropora/database";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import type { RequiredTableCheck } from "./stock-diagnostics.types.js";

/// Narrow read-only surface this module needs - kept separate from
/// InventoryMovementDatabase/StockReconciliationDatabase (this module never
/// writes, and needs a few tables neither of those interfaces exposes, e.g.
/// SalesOrder just for a reachability probe).
export interface StockDiagnosticsDatabase {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  stockItem: { count(args?: unknown): Promise<number> };
  stockMovement: { count(args?: unknown): Promise<number> };
  salesOrder: { count(args?: unknown): Promise<number> };
  unasStockSyncOutbox: {
    count(args?: unknown): Promise<number>;
    groupBy(args: unknown): Promise<Array<{ status: string; _count: { _all: number } }>>;
    findFirst(args: unknown): Promise<{ createdAt: Date } | null>;
  };
  unasProductSnapshot: {
    count(args?: unknown): Promise<number>;
    findMany(
      args: unknown,
    ): Promise<Array<{ reportedStock: unknown; reportedStockSyncedAt: Date | null }>>;
  };
  releaseEvidence: {
    findFirst(args: unknown): Promise<{
      id: string;
      status: string;
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
    } | null>;
  };
}

export const STOCK_DIAGNOSTICS_DATABASE = Symbol("STOCK_DIAGNOSTICS_DATABASE");

const REQUIRED_TABLES = ["stockItem", "stockMovement", "salesOrder", "unasStockSyncOutbox"] as const;

/// Directory holding this project's hand-written migration folders - see
/// docs/INVENTORY-CONSISTENCY.md's migration-convention note (prisma
/// generate/migrate dev can't run in the sandbox this was built in, so
/// every migration here is a hand-written raw-SQL folder matching Prisma's
/// own naming: <timestamp>_<description>). Resolved relative to this
/// compiled file's own location rather than process.cwd(), so it keeps
/// working regardless of which directory the API process happens to be
/// started from.
function migrationsDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../../../packages/database/prisma/migrations");
}

@Injectable()
export class StockDiagnosticsRepository {
  private readonly database: StockDiagnosticsDatabase;

  constructor(
    @Optional()
    @Inject(STOCK_DIAGNOSTICS_DATABASE)
    database?: StockDiagnosticsDatabase,
  ) {
    this.database = database ?? (prisma as unknown as StockDiagnosticsDatabase);
  }

  async checkDatabase(): Promise<{ reachable: boolean; latencyMs: number | null }> {
    const startedAt = performance.now();
    try {
      await this.database.$queryRaw`SELECT 1`;
      return { reachable: true, latencyMs: Math.round(performance.now() - startedAt) };
    } catch {
      return { reachable: false, latencyMs: null };
    }
  }

  /// Cheap `count()` probe per required table - not a schema/columns check
  /// (Prisma's generated client already guarantees the shape matches the
  /// schema it was generated from; this only proves the table is actually
  /// reachable over the current connection, e.g. not dropped/renamed by an
  /// out-of-band operation).
  async checkRequiredTables(): Promise<RequiredTableCheck[]> {
    const results: RequiredTableCheck[] = [];
    for (const table of REQUIRED_TABLES) {
      try {
        await this.database[table].count();
        results.push({ table, reachable: true });
      } catch {
        results.push({ table, reachable: false });
      }
    }
    return results;
  }

  async outboxStatusCounts(): Promise<Record<string, number>> {
    const rows = await this.database.unasStockSyncOutbox.groupBy({
      by: ["status"],
      _count: { _all: true },
    });
    const counts: Record<string, number> = {};
    for (const row of rows) counts[row.status] = row._count._all;
    return counts;
  }

  async oldestPendingAgeSeconds(): Promise<number | null> {
    const oldest = await this.database.unasStockSyncOutbox.findFirst({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    });
    return oldest ? Math.round((Date.now() - oldest.createdAt.getTime()) / 1000) : null;
  }

  async expiredProcessingLeaseCount(): Promise<number> {
    return this.database.unasStockSyncOutbox.count({
      where: { status: "PROCESSING", leaseExpiresAt: { lt: new Date() } },
    });
  }

  async unasSnapshotFreshness(): Promise<{
    productsWithReportedStock: number;
    syncedAts: Array<Date | null>;
  }> {
    const rows = await this.database.unasProductSnapshot.findMany({
      where: { reportedStock: { not: null } },
      select: { reportedStockSyncedAt: true },
    });
    return {
      productsWithReportedStock: rows.length,
      syncedAts: rows.map((row) => row.reportedStockSyncedAt),
    };
  }

  /// Compares the on-disk hand-written migration folders against
  /// Postgres's own `_prisma_migrations` bookkeeping table (the same table
  /// `prisma migrate deploy` itself writes to, so this stays accurate even
  /// though this project can't run `prisma migrate` in the sandbox it was
  /// developed in - every migration here was applied by hand-running the
  /// same raw SQL `prisma migrate deploy` would have run, followed by an
  /// insert into this table - see docs/INVENTORY-CONSISTENCY.md). Returns
  /// `checked: false` (not a false "all applied") if EITHER side can't be
  /// read, e.g. this deployment's runtime image doesn't ship the
  /// migrations source folder.
  async migrationStatus(): Promise<{
    checked: boolean;
    expected: string[];
    applied: string[];
  }> {
    let expected: string[] = [];
    try {
      const entries = await readdir(migrationsDir(), { withFileTypes: true });
      expected = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    } catch {
      return { checked: false, expected: [], applied: [] };
    }

    try {
      const rows = await this.database.$queryRaw<Array<{ migration_name: string }>>`
        SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL
      `;
      return { checked: true, expected, applied: rows.map((row) => row.migration_name) };
    } catch {
      return { checked: false, expected, applied: [] };
    }
  }

  /// Newest SUCCESS row for the given (evidenceType, commitSha) pair - see
  /// schema.prisma's own ReleaseEvidence doc comment. Deliberately does NOT
  /// return a FAILURE row as if it were usable evidence, and deliberately
  /// does NOT fall back to a different commit's evidence - an exact,
  /// current-commit match is the entire point (see
  /// stock-diagnostics.service.ts::activationReadiness's own comment on
  /// why a stale commit's SUCCESS must never silently unblock a new
  /// release).
  async findLatestConcurrencyTestEvidence(commitSha: string): Promise<{
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
  } | null> {
    return this.database.releaseEvidence.findFirst({
      where: {
        evidenceType: "INVENTORY_POSTGRES_CONCURRENCY_TEST",
        status: "SUCCESS",
        commitSha,
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        commitSha: true,
        workflowRunId: true,
        repository: true,
        workflowName: true,
        jobName: true,
        triggerEvent: true,
        environment: true,
        databaseEngine: true,
        databaseEngineVersion: true,
        testSuite: true,
        createdAt: true,
        completedAt: true,
      },
    });
  }
}
