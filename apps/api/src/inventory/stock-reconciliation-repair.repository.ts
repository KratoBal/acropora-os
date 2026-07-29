import { Inject, Injectable, Optional } from "@nestjs/common";
import { Prisma, Repository, prisma } from "@acropora/database";

import {
  enqueueStockSyncOutboxEntry,
  lockVariantWarehouse,
  type InventoryMovementDatabase,
} from "../common/inventory-movement-writer.js";
import {
  evaluateLocalFromProvenLedgerPreconditions,
  evaluateRepublishPreconditions,
} from "./stock-reconciliation-repair.util.js";
import type {
  RepairRejectionCode,
  StockReconciliationRepairRecord,
  StockReconciliationRepairOutcome,
  StockReconciliationRepairType,
} from "./stock-reconciliation-repair.types.js";
import {
  StockReconciliationRepository,
  type StockReconciliationDatabase,
} from "./stock-reconciliation.repository.js";

interface StockItemForRepair {
  id: string;
  variantId: string;
  warehouseId: string;
  onHand: Prisma.Decimal;
  variant: { sku: string };
}

interface RepairRow {
  id: string;
  repairType: string;
  status: string;
  stockItemId: string | null;
  variantId: string;
  warehouseId: string;
  actorUserId: string;
  reason: string;
  expectedCurrentOnHand: Prisma.Decimal;
  beforeOnHand: Prisma.Decimal | null;
  afterOnHand: Prisma.Decimal | null;
  ledgerExpectedOnHand: Prisma.Decimal | null;
  outboxId: string | null;
  resultDetail: Prisma.JsonValue;
  createdAt: Date;
  completedAt: Date | null;
}

// Widens InventoryMovementDatabase (needed for lockVariantWarehouse and
// enqueueStockSyncOutboxEntry, both reused verbatim from
// inventory-movement-writer.ts) with StockReconciliationDatabase's own
// shape, so a fresh StockReconciliationRepository can be constructed
// AROUND THIS SAME transaction client and recompute
// ledgerExpectedOnHand/ledgerProvable truly under the lock, in the SAME
// transaction - never against the outer, unlocked `prisma` singleton (see
// applyLocalFromProvenLedger's own comment on why this matters: a second,
// separately-bound repository instance would silently read outside the
// transaction).
//
// Deliberately NOT built by intersecting InventoryMovementDatabase's and
// StockReconciliationDatabase's own `stockItem`/`unasStockSyncOutbox`
// property types (both declare a same-named method - `findFirst` on one
// side, none on the other, but TS still merges same-named properties'
// function types into a multi-signature intersection and picks the FIRST
// declared signature on a call - silently resolving `findFirst`'s return
// type back to InventoryMovementDatabase's own bare `{id, onHand}`
// StockItemRow instead of the richer shape this file actually needs).
// Each nested property is instead spelled out once, explicitly, below.
interface RepairTransaction extends Pick<InventoryMovementDatabase, "$executeRaw" | "stockMovement"> {
  stockItem: {
    findFirst(args: unknown): Promise<StockItemForRepair | null>;
    update(args: unknown): Promise<unknown>;
    create(args: unknown): Promise<unknown>;
    findMany: StockReconciliationDatabase["stockItem"]["findMany"];
    count: StockReconciliationDatabase["stockItem"]["count"];
    groupBy: StockReconciliationDatabase["stockItem"]["groupBy"];
  };
  stockMovementLine: {
    create(args: unknown): Promise<unknown>;
    findMany: StockReconciliationDatabase["stockMovementLine"]["findMany"];
  };
  productVariant: StockReconciliationDatabase["productVariant"];
  unasStockSyncOutbox: {
    updateMany(args: unknown): Promise<{ count: number }>;
    create(args: unknown): Promise<{ id: string }>;
    findFirst(args: unknown): Promise<{ id: string; status: string } | null>;
    findMany: StockReconciliationDatabase["unasStockSyncOutbox"]["findMany"];
  };
  stockReconciliationRepair: {
    create(args: unknown): Promise<RepairRow>;
  };
}

export interface StockReconciliationRepairDatabase {
  stockReconciliationRepair: {
    findFirst(args: unknown): Promise<RepairRow | null>;
    findUnique(args: unknown): Promise<RepairRow | null>;
  };
  $transaction<T>(
    operation: (transaction: RepairTransaction) => Promise<T>,
    options?: unknown,
  ): Promise<T>;
}

export const STOCK_RECONCILIATION_REPAIR_DATABASE = Symbol(
  "STOCK_RECONCILIATION_REPAIR_DATABASE",
);

function toRecord(row: RepairRow): StockReconciliationRepairRecord {
  const detail =
    row.resultDetail && typeof row.resultDetail === "object" && !Array.isArray(row.resultDetail)
      ? (row.resultDetail as Record<string, unknown>)
      : {};
  return {
    id: row.id,
    repairType: row.repairType as StockReconciliationRepairType,
    status: row.status as StockReconciliationRepairRecord["status"],
    stockItemId: row.stockItemId,
    variantId: row.variantId,
    warehouseId: row.warehouseId,
    actorUserId: row.actorUserId,
    reason: row.reason,
    expectedCurrentOnHand: row.expectedCurrentOnHand.toString(),
    beforeOnHand: row.beforeOnHand?.toString() ?? null,
    afterOnHand: row.afterOnHand?.toString() ?? null,
    ledgerExpectedOnHand: row.ledgerExpectedOnHand?.toString() ?? null,
    outboxId: row.outboxId,
    rejectionCode: (detail.rejectionCode as RepairRejectionCode | undefined) ?? null,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

function toOutcome(row: RepairRow, replayedExisting: boolean): StockReconciliationRepairOutcome {
  const record = toRecord(row);
  return {
    dryRun: false,
    status: record.status,
    rejectionCode: record.rejectionCode,
    variantId: record.variantId,
    warehouseId: record.warehouseId,
    ledgerExpectedOnHand: record.ledgerExpectedOnHand,
    beforeOnHand: record.beforeOnHand,
    afterOnHand: record.afterOnHand,
    outboxId: record.outboxId,
    repairId: record.id,
    replayedExisting,
  };
}

/// Transactional data access for the checkpoint-6 repair mechanism. Every
/// mutating method here runs its ENTIRE effect (advisory lock, fresh
/// re-read, precondition re-check, StockItem/outbox mutation, and the
/// audit-row insert) inside ONE Prisma transaction - see each method's own
/// comment for the exact step order the checkpoint required. A thrown
/// error anywhere in that transaction rolls back everything, including the
/// audit row itself, so there is never a "SUCCESS audit with a partial
/// mutation" state - see schema.prisma's own doc comment on
/// StockReconciliationRepairStatus for why FAILED isn't even a status this
/// model can represent.
@Injectable()
export class StockReconciliationRepairRepository extends Repository {
  private readonly repairDatabase: StockReconciliationRepairDatabase;

  constructor(
    @Optional()
    @Inject(STOCK_RECONCILIATION_REPAIR_DATABASE)
    database?: StockReconciliationRepairDatabase,
  ) {
    super(prisma);
    this.repairDatabase =
      database ?? (prisma as unknown as StockReconciliationRepairDatabase);
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<StockReconciliationRepairRecord | null> {
    const row = await this.repairDatabase.stockReconciliationRepair.findFirst({
      where: { idempotencyKey },
    });
    return row ? toRecord(row) : null;
  }

  async findById(id: string): Promise<StockReconciliationRepairRecord | null> {
    const row = await this.repairDatabase.stockReconciliationRepair.findUnique({ where: { id } });
    return row ? toRecord(row) : null;
  }

  /// Type A. Inside one transaction: lock (variantId, warehouseId) ->
  /// re-read StockItem fresh, by its real business key -> re-derive
  /// ledgerExpectedOnHand/ledgerProvable fresh, via a
  /// StockReconciliationRepository constructed AROUND THIS transaction's
  /// own client (never the outer `prisma` singleton - see the interface's
  /// own comment above) -> re-check the exact same
  /// evaluateLocalFromProvenLedgerPreconditions the pre-lock preview used
  /// -> if rejected, insert a REJECTED audit row (no StockItem write); if
  /// the ledger already matches onHand, insert a NOOP row (no StockItem
  /// write); otherwise update StockItem.onHand to ledgerExpectedOnHand,
  /// enqueue an outbox entry via the SAME enqueueStockSyncOutboxEntry
  /// helper postInventoryMovement itself uses, and insert an APPLIED row -
  /// all before the transaction commits. Deliberately never creates a
  /// StockMovement: this corrects the ledger's OWN already-recorded
  /// conclusion back onto StockItem, it is not a new physical stock event.
  async applyLocalFromProvenLedger(params: {
    variantId: string;
    warehouseId: string;
    expectedCurrentOnHand: Prisma.Decimal;
    reason: string;
    actorUserId: string;
    idempotencyKey: string;
  }): Promise<StockReconciliationRepairOutcome> {
    const row = await this.repairDatabase.$transaction(async (transaction) => {
      await lockVariantWarehouse(transaction, params.variantId, params.warehouseId);

      const stockItem = await transaction.stockItem.findFirst({
        where: {
          variantId: params.variantId,
          warehouseId: params.warehouseId,
          locationId: null,
          lotId: null,
        },
        include: { variant: { select: { sku: true } } },
      });
      if (!stockItem) {
        // Structurally shouldn't happen - StockItem rows are never
        // deleted anywhere in this codebase - but if it somehow did, there
        // is nothing safe to lock/repair/audit against; abort the whole
        // transaction (no row persists at all) rather than guess.
        throw new Error("STOCK_ITEM_VANISHED_DURING_REPAIR");
      }

      // Recomputes ledgerExpectedOnHand/ledgerProvable INSIDE this same
      // transaction, under the lock just acquired - a repository bound to
      // the outer `prisma` client would read outside the transaction and
      // could see a stale (or, with another writer mid-flight, an
      // inconsistent) snapshot.
      const fresh = await new StockReconciliationRepository(
        transaction,
      ).reconcileByStockItemId(stockItem.id);
      if (!fresh) throw new Error("STOCK_ITEM_VANISHED_DURING_REPAIR");

      const rejectionCode = evaluateLocalFromProvenLedgerPreconditions({
        ledgerProvable: fresh.ledgerProvable,
        localOnHand: stockItem.onHand,
        expectedCurrentOnHand: params.expectedCurrentOnHand,
      });

      const base = {
        repairType: "LOCAL_FROM_PROVEN_LEDGER" as const,
        stockItemId: stockItem.id,
        variantId: params.variantId,
        warehouseId: params.warehouseId,
        actorUserId: params.actorUserId,
        reason: params.reason,
        idempotencyKey: params.idempotencyKey,
        expectedCurrentOnHand: params.expectedCurrentOnHand,
        ledgerExpectedOnHand: fresh.ledgerExpectedOnHand
          ? new Prisma.Decimal(fresh.ledgerExpectedOnHand)
          : null,
      };

      if (rejectionCode) {
        return transaction.stockReconciliationRepair.create({
          data: {
            ...base,
            status: "REJECTED",
            completedAt: new Date(),
            resultDetail: { rejectionCode },
          },
        });
      }

      const ledgerExpectedOnHand = new Prisma.Decimal(fresh.ledgerExpectedOnHand!);
      if (ledgerExpectedOnHand.equals(stockItem.onHand)) {
        return transaction.stockReconciliationRepair.create({
          data: {
            ...base,
            status: "NOOP",
            beforeOnHand: stockItem.onHand,
            afterOnHand: stockItem.onHand,
            completedAt: new Date(),
            resultDetail: { note: "ledger already matched onHand" },
          },
        });
      }

      await transaction.stockItem.update({
        where: { id: stockItem.id },
        data: { onHand: ledgerExpectedOnHand },
      });

      const outbox = await enqueueStockSyncOutboxEntry(transaction, {
        variantId: params.variantId,
        warehouseId: params.warehouseId,
        sku: stockItem.variant.sku,
        targetOnHand: ledgerExpectedOnHand,
        idempotencyKey: `${params.idempotencyKey}:outbox`,
        sourceProcess: "RECONCILIATION",
        sourceRecordId: params.idempotencyKey,
      });

      return transaction.stockReconciliationRepair.create({
        data: {
          ...base,
          status: "APPLIED",
          beforeOnHand: stockItem.onHand,
          afterOnHand: ledgerExpectedOnHand,
          outboxId: outbox.id,
          completedAt: new Date(),
        },
      });
    });

    return toOutcome(row, false);
  }

  /// Type B. Inside one transaction: lock -> re-read StockItem fresh ->
  /// re-check UNAS link / expectedCurrentOnHand / "no competing open
  /// outbox row" (fresh, under the lock) -> if rejected, insert a REJECTED
  /// row; otherwise enqueue a fresh outbox entry (via the same shared
  /// helper) targeting the current onHand, and insert an APPLIED row.
  /// Never calls the UNAS API directly, never touches StockItem.
  async applyRepublishLocalToUnas(params: {
    variantId: string;
    warehouseId: string;
    hasUnasLink: boolean;
    expectedCurrentOnHand: Prisma.Decimal;
    reason: string;
    actorUserId: string;
    idempotencyKey: string;
  }): Promise<StockReconciliationRepairOutcome> {
    const row = await this.repairDatabase.$transaction(async (transaction) => {
      await lockVariantWarehouse(transaction, params.variantId, params.warehouseId);

      const stockItem = await transaction.stockItem.findFirst({
        where: {
          variantId: params.variantId,
          warehouseId: params.warehouseId,
          locationId: null,
          lotId: null,
        },
        include: { variant: { select: { sku: true } } },
      });
      if (!stockItem) throw new Error("STOCK_ITEM_VANISHED_DURING_REPAIR");

      const competingRow = await transaction.unasStockSyncOutbox.findFirst({
        where: {
          variantId: params.variantId,
          warehouseId: params.warehouseId,
          status: { in: ["PENDING", "PROCESSING"] },
        },
      });

      const rejectionCode = evaluateRepublishPreconditions({
        hasUnasLink: params.hasUnasLink,
        localOnHand: stockItem.onHand,
        expectedCurrentOnHand: params.expectedCurrentOnHand,
        hasCompetingOpenOutboxRow: Boolean(competingRow),
      });

      const base = {
        repairType: "REPUBLISH_LOCAL_TO_UNAS" as const,
        stockItemId: stockItem.id,
        variantId: params.variantId,
        warehouseId: params.warehouseId,
        actorUserId: params.actorUserId,
        reason: params.reason,
        idempotencyKey: params.idempotencyKey,
        expectedCurrentOnHand: params.expectedCurrentOnHand,
      };

      if (rejectionCode) {
        return transaction.stockReconciliationRepair.create({
          data: {
            ...base,
            status: "REJECTED",
            completedAt: new Date(),
            resultDetail: { rejectionCode },
          },
        });
      }

      const outbox = await enqueueStockSyncOutboxEntry(transaction, {
        variantId: params.variantId,
        warehouseId: params.warehouseId,
        sku: stockItem.variant.sku,
        targetOnHand: stockItem.onHand,
        idempotencyKey: `${params.idempotencyKey}:outbox`,
        sourceProcess: "RECONCILIATION",
        sourceRecordId: params.idempotencyKey,
      });

      return transaction.stockReconciliationRepair.create({
        data: {
          ...base,
          status: "APPLIED",
          beforeOnHand: stockItem.onHand,
          afterOnHand: stockItem.onHand,
          outboxId: outbox.id,
          completedAt: new Date(),
        },
      });
    });

    return toOutcome(row, false);
  }
}
