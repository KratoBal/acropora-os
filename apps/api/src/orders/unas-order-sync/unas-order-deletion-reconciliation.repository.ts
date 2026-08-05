import { Inject, Injectable, Optional } from "@nestjs/common";
import { prisma } from "@acropora/database";

/// Claimed candidate row for one existence-check attempt - see
/// claimBatch's own doc comment for the concurrency/crash-recovery
/// rationale (mirrors UnasStockSyncOutboxRepository.claimBatch exactly,
/// just against SalesOrder's own lease columns instead of a dedicated
/// outbox table).
export interface ClaimedDeletionCandidate {
  id: string;
  /// UNAS Key for this order (ExternalReference.externalKey), or null if
  /// - defensively - no ExternalReference row exists at all (shouldn't
  /// happen for a channel=UNAS order, but never assumed). A null key means
  /// there is nothing to check this order against, so the caller skips it
  /// without burning a real UNAS call.
  unasKey: string | null;
  attempts: number;
}

export interface UnasOrderDeletionReconciliationDatabase {
  $queryRaw<T = unknown>(
    query: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T>;
  salesOrder: {
    update(args: unknown): Promise<unknown>;
  };
}

export const UNAS_ORDER_DELETION_RECONCILIATION_DATABASE = Symbol(
  "UNAS_ORDER_DELETION_RECONCILIATION_DATABASE",
);

@Injectable()
export class UnasOrderDeletionReconciliationRepository {
  private readonly database: UnasOrderDeletionReconciliationDatabase;

  constructor(
    @Optional()
    @Inject(UNAS_ORDER_DELETION_RECONCILIATION_DATABASE)
    database?: UnasOrderDeletionReconciliationDatabase,
  ) {
    this.database =
      database ??
      (prisma as unknown as UnasOrderDeletionReconciliationDatabase);
  }

  /// Atomically claims up to `batchSize` locally-still-open UNAS orders
  /// that are either due for their first/next existence check
  /// (`unasExistenceCheckDueAt` NULL or in the past) or were left behind by
  /// a crashed worker (`unasExistenceCheckLeaseExpiresAt` expired), and
  /// marks them claimed with a fresh lease - all in one SQL statement, via
  /// `FOR UPDATE SKIP LOCKED` (same technique, same rationale, as
  /// UnasStockSyncOutboxRepository.claimBatch's own doc comment - Prisma's
  /// query builder has no equivalent).
  ///
  /// Scope, deliberately conservative per business rule 6 ("csak indokolt,
  /// helyben aktív/nem terminális UNAS-rendeléseket vizsgáljon"): only
  /// `channel = 'UNAS'`, only orders NOT already `unasDeletedAt` (already
  /// resolved, nothing left to check - permanently excluded, never
  /// reconsidered), and only a non-terminal `status` (CANCELLED/COMPLETED
  /// orders are done, whether or not they were ever UNAS-deleted -
  /// checking them again would burn UNAS API budget for zero value). A
  /// never-checked order (`unasExistenceCheckDueAt IS NULL`) sorts first
  /// (`NULLS FIRST`) so a fresh deploy's backlog of never-yet-scheduled
  /// orders drains in a stable, predictable order rather than being starved
  /// by a due-at set far in the future.
  ///
  /// The UNAS Key is resolved in the SAME statement via a correlated
  /// subquery against ExternalReference, so the caller never needs a
  /// second per-row query just to find out what to check.
  async claimBatch(params: {
    batchSize: number;
    leaseSeconds: number;
    workerId: string;
  }): Promise<ClaimedDeletionCandidate[]> {
    const rows = await this.database.$queryRaw<
      Array<{ id: string; unasKey: string | null; attempts: number }>
    >`
      WITH claimable AS (
        SELECT "id" FROM "SalesOrder"
        WHERE "channel" = 'UNAS'
          AND "unasDeletedAt" IS NULL
          AND "status" NOT IN ('CANCELLED', 'COMPLETED')
          AND (
            "unasExistenceCheckLeaseExpiresAt" IS NULL
            OR "unasExistenceCheckLeaseExpiresAt" < now()
          )
          AND (
            "unasExistenceCheckDueAt" IS NULL
            OR "unasExistenceCheckDueAt" <= now()
          )
        ORDER BY "unasExistenceCheckDueAt" ASC NULLS FIRST
        LIMIT ${params.batchSize}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "SalesOrder" AS o
      SET
        "unasExistenceCheckLeaseExpiresAt" = now() + make_interval(secs => ${params.leaseSeconds}),
        "unasExistenceCheckClaimedBy" = ${params.workerId},
        "unasExistenceCheckAttempts" = o."unasExistenceCheckAttempts" + 1
      FROM claimable AS c
      WHERE o."id" = c."id"
      RETURNING
        o."id",
        o."unasExistenceCheckAttempts" AS "attempts",
        (
          SELECT er."externalKey" FROM "ExternalReference" er
          WHERE er."system" = 'UNAS'
            AND er."entityType" = 'SalesOrder'
            AND er."entityId" = o."id"
          LIMIT 1
        ) AS "unasKey"
    `;
    return rows;
  }

  /// Releases a claimed row after the order was confirmed to STILL exist
  /// in UNAS (or the check failed transiently - see the caller's own
  /// classification): clears the lease and reschedules the next check.
  /// Never touches status/unasDeletedAt - those are exclusively
  /// UnasOrderSyncRepository.reconcileDeletedOrder's responsibility, so a
  /// "still exists" / "transient failure" outcome here can never
  /// accidentally resurrect or half-modify an order's business state.
  async releaseAfterCheck(params: {
    orderId: string;
    nextCheckDelayMs: number;
  }): Promise<void> {
    await this.database.salesOrder.update({
      where: { id: params.orderId },
      data: {
        unasExistenceCheckDueAt: new Date(Date.now() + params.nextCheckDelayMs),
        unasExistenceCheckLeaseExpiresAt: null,
        unasExistenceCheckClaimedBy: null,
      },
    });
  }

  /// Called after reconcileDeletedOrder has already handled the actual
  /// deletion (status/unasDeletedAt/stock reversal) - this only clears the
  /// now-irrelevant lease/due-at bookkeeping. Safe to call even if
  /// reconcileDeletedOrder found the order already reconciled by a
  /// concurrent caller (alreadyReconciled: true): clearing these fields
  /// again is a harmless no-op either way.
  async clearAfterDeletion(orderId: string): Promise<void> {
    await this.database.salesOrder.update({
      where: { id: orderId },
      data: {
        unasExistenceCheckDueAt: null,
        unasExistenceCheckLeaseExpiresAt: null,
        unasExistenceCheckClaimedBy: null,
      },
    });
  }

  /// Skips a candidate with no resolvable UNAS Key at all (defensive-only -
  /// see ClaimedDeletionCandidate.unasKey's doc comment) without burning a
  /// UNAS call or touching business state - just pushes the due-at out so
  /// it doesn't get reclaimed on every single tick.
  async skipUnresolvable(params: {
    orderId: string;
    nextCheckDelayMs: number;
  }): Promise<void> {
    await this.releaseAfterCheck({
      orderId: params.orderId,
      nextCheckDelayMs: params.nextCheckDelayMs,
    });
  }
}
