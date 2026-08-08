import {
  ConflictException,
  Inject,
  Injectable,
  Optional,
} from "@nestjs/common";
import { Prisma, Repository, prisma } from "@acropora/database";

export type UnasStockSyncOutboxStatus =
  "PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "DEAD_LETTER";

export interface ClaimedUnasStockSyncOutboxRow {
  id: string;
  variantId: string;
  warehouseId: string;
  sku: string;
  targetOnHand: Prisma.Decimal;
  idempotencyKey: string;
  sourceProcess: string;
  sourceRecordId: string;
  attempts: number;
  sequence: bigint;
}

export interface UnasStockSyncOutboxListItem {
  id: string;
  variantId: string;
  warehouseId: string;
  sku: string;
  targetOnHand: Prisma.Decimal;
  status: UnasStockSyncOutboxStatus;
  attempts: number;
  nextAttemptAt: Date;
  lastError: string | null;
  resolutionNote: string | null;
  sourceProcess: string;
  sourceRecordId: string;
  createdAt: Date;
  updatedAt: Date;
  processedAt: Date | null;
}

export interface UnasStockSyncOutboxDatabase {
  $queryRaw<T = unknown>(
    query: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T>;
  unasStockSyncOutbox: {
    findFirst(args: unknown): Promise<{
      id: string;
      status: UnasStockSyncOutboxStatus;
    } | null>;
    findMany(args: unknown): Promise<UnasStockSyncOutboxListItem[]>;
    update(args: unknown): Promise<unknown>;
    updateMany(args: unknown): Promise<{ count: number }>;
    groupBy(args: unknown): Promise<Array<{ status: string; _count: number }>>;
    aggregate(args: unknown): Promise<{ _max: { processedAt: Date | null } }>;
  };
}

export const UNAS_STOCK_SYNC_OUTBOX_DATABASE = Symbol(
  "UNAS_STOCK_SYNC_OUTBOX_DATABASE",
);

/// Data access for the transactional UNAS stock-sync outbox. The claim
/// query (`claimBatch`) is the only place in this codebase, besides the
/// advisory lock in inventory-movement-writer.ts, that has to drop to raw
/// SQL: Prisma's query builder has no `FOR UPDATE SKIP LOCKED` support, and
/// the "claim N rows and flip their status in one atomic statement"
/// pattern needs it to be safe across multiple concurrent worker
/// processes/instances. See the doc comment on `claimBatch` for the full
/// concurrency + crash-recovery rationale.
@Injectable()
export class UnasStockSyncOutboxRepository extends Repository {
  private readonly outboxDatabase: UnasStockSyncOutboxDatabase;

  constructor(
    @Optional()
    @Inject(UNAS_STOCK_SYNC_OUTBOX_DATABASE)
    database?: UnasStockSyncOutboxDatabase,
  ) {
    super(prisma);
    this.outboxDatabase =
      database ?? (prisma as unknown as UnasStockSyncOutboxDatabase);
  }

  /// Atomically claims up to `batchSize` rows that are either due for a
  /// first/retried attempt (`PENDING`/`FAILED` with `nextAttemptAt` in the
  /// past) or were left behind by a crashed worker (`PROCESSING` with an
  /// expired `leaseExpiresAt`), and marks them `PROCESSING` with a fresh
  /// lease - all in a single SQL statement.
  ///
  /// Concurrency safety: the inner `SELECT ... FOR UPDATE SKIP LOCKED`
  /// means that if two worker instances (or two ticks of the same
  /// scheduler racing a manual "run now" call) execute this at the same
  /// moment, each row is only ever included in exactly one of their result
  /// sets - the other simply skips any row it can't immediately lock,
  /// rather than blocking on it or claiming it twice. Because the SELECT
  /// and the UPDATE are one statement (a CTE feeding an `UPDATE ... FROM`),
  /// there is no gap between "decide which rows to claim" and "mark them
  /// claimed" for another transaction to land in.
  ///
  /// Crash recovery: a worker that dies (process kill, OOM, deploy) after
  /// claiming a row but before finishing it leaves that row `PROCESSING`
  /// forever *unless* something re-examines `leaseExpiresAt`. This query's
  /// WHERE clause explicitly re-claims any `PROCESSING` row whose lease has
  /// expired, so the very next scheduled tick (by this or another worker
  /// instance) picks it back up - no separate reaper job needed. Choose
  /// `leaseSeconds` comfortably longer than the slowest expected
  /// `setStock` call (including its own internal HTTP retries); too short
  /// risks two workers processing the same row while a slow-but-alive
  /// worker still holds it, too long delays recovery from a real crash.
  async claimBatch(params: {
    batchSize: number;
    leaseSeconds: number;
    workerId: string;
  }): Promise<ClaimedUnasStockSyncOutboxRow[]> {
    const rows = await this.outboxDatabase.$queryRaw<
      Array<{
        id: string;
        variantId: string;
        warehouseId: string;
        sku: string;
        targetOnHand: Prisma.Decimal;
        idempotencyKey: string;
        sourceProcess: string;
        sourceRecordId: string;
        attempts: number;
        sequence: bigint;
      }>
    >`
      WITH claimable AS (
        SELECT "id" FROM "UnasStockSyncOutbox"
        WHERE (
          ("status" IN ('PENDING', 'FAILED') AND "nextAttemptAt" <= now())
          OR ("status" = 'PROCESSING' AND "leaseExpiresAt" IS NOT NULL AND "leaseExpiresAt" < now())
        )
        ORDER BY "sequence" ASC
        LIMIT ${params.batchSize}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "UnasStockSyncOutbox" AS o
      SET
        "status" = 'PROCESSING',
        "attempts" = o."attempts" + 1,
        "leaseExpiresAt" = now() + make_interval(secs => ${params.leaseSeconds}),
        "claimedBy" = ${params.workerId},
        "updatedAt" = now()
      FROM claimable AS c
      WHERE o."id" = c."id"
      RETURNING
        o."id", o."variantId", o."warehouseId", o."sku", o."targetOnHand",
        o."idempotencyKey", o."sourceProcess", o."sourceRecordId",
        o."attempts", o."sequence"
    `;
    return rows;
  }

  /// Atomically claims only stock-publish rows created by one UNAS order.
  /// This is the narrow manual recovery path used by the single-order
  /// refresh endpoint while the global worker is disabled. The
  /// sourceRecordId filter is the local SalesOrder.id written by
  /// postInventoryMovement; the sourceProcess allow-list prevents a
  /// coincidentally equal id from another stock-writing flow from being
  /// published. It deliberately shares the same lease/attempt semantics as
  /// claimBatch, so concurrent manual refreshes and a future enabled worker
  /// still cannot claim the same row twice.
  async claimForUnasOrder(params: {
    orderId: string;
    batchSize: number;
    leaseSeconds: number;
    workerId: string;
  }): Promise<ClaimedUnasStockSyncOutboxRow[]> {
    return this.outboxDatabase.$queryRaw<ClaimedUnasStockSyncOutboxRow[]>`
      WITH claimable AS (
        SELECT "id" FROM "UnasStockSyncOutbox"
        WHERE "sourceRecordId" = ${params.orderId}
          AND "sourceProcess" IN (
            'UNAS_ORDER_IMPORT',
            'UNAS_ORDER_UPDATE',
            'UNAS_ORDER_CANCEL',
            'UNAS_ORDER_DELETED'
          )
          AND (
            ("status" IN ('PENDING', 'FAILED') AND "nextAttemptAt" <= now())
            OR ("status" = 'PROCESSING' AND "leaseExpiresAt" IS NOT NULL AND "leaseExpiresAt" < now())
          )
        ORDER BY "sequence" ASC
        LIMIT ${params.batchSize}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "UnasStockSyncOutbox" AS o
      SET
        "status" = 'PROCESSING',
        "attempts" = o."attempts" + 1,
        "leaseExpiresAt" = now() + make_interval(secs => ${params.leaseSeconds}),
        "claimedBy" = ${params.workerId},
        "updatedAt" = now()
      FROM claimable AS c
      WHERE o."id" = c."id"
      RETURNING
        o."id", o."variantId", o."warehouseId", o."sku", o."targetOnHand",
        o."idempotencyKey", o."sourceProcess", o."sourceRecordId",
        o."attempts", o."sequence"
    `;
  }

  /// True when a NEWER outbox row exists for the same (variantId,
  /// warehouseId) - i.e. a stock movement happened after this row was
  /// written, so publishing this row's `targetOnHand` would push a stale
  /// value. Checked immediately before the UNAS call, not just at row
  /// creation, specifically to cover the window where the newer movement
  /// arrived while this row was already `PROCESSING` (and therefore wasn't
  /// eligible to be superseded by the writer's own supersede-on-create
  /// step in inventory-movement-writer.ts).
  async isSuperseded(params: {
    id: string;
    variantId: string;
    warehouseId: string;
    sequence: bigint;
  }): Promise<{ supersededByOutboxId: string } | null> {
    const [latest] = await this.outboxDatabase.$queryRaw<
      Array<{ id: string; sequence: bigint }>
    >`
      SELECT "id", "sequence" FROM "UnasStockSyncOutbox"
      WHERE "variantId" = ${params.variantId}
        AND "warehouseId" = ${params.warehouseId}
      ORDER BY "sequence" DESC
      LIMIT 1
    `;
    if (!latest || latest.id === params.id) return null;
    if (latest.sequence <= params.sequence) return null;
    return { supersededByOutboxId: latest.id };
  }

  async markSucceeded(id: string): Promise<void> {
    await this.outboxDatabase.unasStockSyncOutbox.update({
      where: { id },
      data: {
        status: "SUCCEEDED",
        leaseExpiresAt: null,
        processedAt: new Date(),
      },
    });
  }

  /// Closed out WITHOUT an actual UNAS call, because a newer row already
  /// covers (or will cover) publishing the current stock. Still recorded
  /// as SUCCEEDED - from the outbox's point of view the desired end state
  /// (UNAS reflects Acropora OS's current stock) is/will be satisfied,
  /// just not by this particular row - `resolutionNote` makes the
  /// distinction auditable.
  async markSupersededSuccess(
    id: string,
    supersededByOutboxId: string,
  ): Promise<void> {
    await this.outboxDatabase.unasStockSyncOutbox.update({
      where: { id },
      data: {
        status: "SUCCEEDED",
        leaseExpiresAt: null,
        resolutionNote: `superseded_by_outbox_id:${supersededByOutboxId}`,
        processedAt: new Date(),
      },
    });
  }

  async markPackageProductSuccess(id: string): Promise<void> {
    await this.outboxDatabase.unasStockSyncOutbox.update({
      where: { id },
      data: {
        status: "SUCCEEDED",
        lastError: null,
        leaseExpiresAt: null,
        resolutionNote: "package_product_not_stock_managed",
        processedAt: new Date(),
      },
    });
  }

  /// Transient failure with retry budget remaining: goes back to FAILED
  /// (still claimable by the next `claimBatch` once `nextAttemptAt`
  /// arrives), lease cleared so it isn't mistaken for an orphan.
  async markFailedForRetry(params: {
    id: string;
    lastError: string;
    nextAttemptAt: Date;
  }): Promise<void> {
    await this.outboxDatabase.unasStockSyncOutbox.update({
      where: { id: params.id },
      data: {
        status: "FAILED",
        lastError: params.lastError,
        nextAttemptAt: params.nextAttemptAt,
        leaseExpiresAt: null,
      },
    });
  }

  /// Terminal failure: retry budget exhausted, or the error is classified
  /// as permanent (see unas-stock-sync-outbox.service.ts) and further
  /// attempts would never succeed on their own. Needs manual attention -
  /// see `manualRetry`.
  async markDeadLetter(params: {
    id: string;
    lastError: string;
  }): Promise<void> {
    await this.outboxDatabase.unasStockSyncOutbox.update({
      where: { id: params.id },
      data: {
        status: "DEAD_LETTER",
        lastError: params.lastError,
        leaseExpiresAt: null,
      },
    });
  }

  /// Safe, idempotent manual retry for an admin: only rows currently
  /// FAILED or DEAD_LETTER are eligible (calling this twice, or on a row
  /// that's already back in flight, is a no-op reported back to the
  /// caller rather than silently double-scheduling it). Resets the
  /// attempts budget, since a manual retry usually follows a fix to
  /// whatever was actually wrong (e.g. the UNAS SKU mapping).
  async manualRetry(
    id: string,
    actorUserId: string | null,
  ): Promise<{ retried: boolean; status: UnasStockSyncOutboxStatus }> {
    const existing = await this.outboxDatabase.unasStockSyncOutbox.findFirst({
      where: { id },
      select: { id: true, status: true },
    });
    if (!existing) {
      throw new ConflictException("UNAS_STOCK_SYNC_OUTBOX_NOT_FOUND");
    }
    if (existing.status !== "FAILED" && existing.status !== "DEAD_LETTER") {
      return { retried: false, status: existing.status };
    }
    const result = await this.outboxDatabase.unasStockSyncOutbox.updateMany({
      where: { id, status: { in: ["FAILED", "DEAD_LETTER"] } },
      data: {
        status: "PENDING",
        attempts: 0,
        nextAttemptAt: new Date(),
        leaseExpiresAt: null,
        resolutionNote: actorUserId
          ? `manual_retry_by:${actorUserId}`
          : "manual_retry",
      },
    });
    // result.count === 0 means another concurrent caller (or the worker
    // itself claiming it in the instant between our findFirst and this
    // updateMany) already moved it out of FAILED/DEAD_LETTER - report that
    // honestly instead of claiming success.
    return { retried: result.count > 0, status: "PENDING" };
  }

  async list(params: {
    status?: UnasStockSyncOutboxStatus;
    limit: number;
  }): Promise<UnasStockSyncOutboxListItem[]> {
    return this.outboxDatabase.unasStockSyncOutbox.findMany({
      where: params.status ? { status: params.status } : {},
      orderBy: { sequence: "desc" },
      take: params.limit,
    });
  }

  async findById(id: string): Promise<UnasStockSyncOutboxListItem | null> {
    const [row] = await this.outboxDatabase.unasStockSyncOutbox.findMany({
      where: { id },
      take: 1,
    });
    return row ?? null;
  }

  async countsByStatus(): Promise<Record<UnasStockSyncOutboxStatus, number>> {
    const groups = await this.outboxDatabase.unasStockSyncOutbox.groupBy({
      by: ["status"],
      _count: true,
    });
    const counts: Record<UnasStockSyncOutboxStatus, number> = {
      PENDING: 0,
      PROCESSING: 0,
      SUCCEEDED: 0,
      FAILED: 0,
      DEAD_LETTER: 0,
    };
    for (const group of groups) {
      counts[group.status as UnasStockSyncOutboxStatus] = group._count;
    }
    return counts;
  }

  /// Last time a row was actually pushed to UNAS successfully (as opposed
  /// to being closed out via supersede, which never calls UNAS) - the
  /// `resolutionNote: null` filter is what distinguishes the two.
  async lastSuccessfulPublishAt(): Promise<Date | null> {
    const result = await this.outboxDatabase.unasStockSyncOutbox.aggregate({
      where: { status: "SUCCEEDED", resolutionNote: null },
      _max: { processedAt: true },
    });
    return result._max.processedAt;
  }
}
