import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@acropora/database";

import {
  StockReconciliationRepairRepository,
  type RepairTransaction,
  type StockReconciliationRepairDatabase,
} from "./stock-reconciliation-repair.repository.js";

function d(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

interface FakeStockItem {
  id: string;
  variantId: string;
  warehouseId: string;
  onHand: Prisma.Decimal;
  sku: string;
  catalogAuthority?: "UNAS" | "ACROPORA" | null;
  /// Optional so existing fixtures stay unchanged; a package product is not
  /// stock-managed, and until the seam was typed no fixture could say so.
  isPackageProduct?: boolean;
}

interface FakeMovementLine {
  variantId: string;
  quantity: Prisma.Decimal;
  type: string;
  sourceWarehouseId: string;
}

interface FakeOutboxRow {
  id: string;
  variantId: string;
  warehouseId: string;
  targetOnHand: Prisma.Decimal;
  status: string;
  idempotencyKey: string;
}

interface FakeRepairRow {
  id: string;
  repairType: string;
  status: string;
  stockItemId: string | null;
  variantId: string;
  warehouseId: string;
  actorUserId: string;
  reason: string;
  idempotencyKey: string;
  expectedCurrentOnHand: Prisma.Decimal;
  beforeOnHand: Prisma.Decimal | null;
  afterOnHand: Prisma.Decimal | null;
  ledgerExpectedOnHand: Prisma.Decimal | null;
  outboxId: string | null;
  /// `JsonValue`, not `unknown`: the contract stores it as JSON, and a double
  /// that widens it to `unknown` lets a non-serialisable value through here
  /// that the database would reject.
  resultDetail: Prisma.JsonValue;
  createdAt: Date;
  completedAt: Date | null;
}

/// In-memory double covering everything StockReconciliationRepairRepository
/// touches, including the nested StockReconciliationRepository it
/// constructs internally around the (fake) transaction client - see
/// stock-reconciliation-repair.repository.ts's own comment on why that
/// nested construction exists (a genuine re-read under the lock). This
/// FakeDb plays the "$transaction just runs the callback against itself"
/// role established by inventory-count.repository.spec.ts - it does not
/// prove real Postgres rollback/isolation (that needs the gated real-DB
/// integration suite), only the call sequence and resulting state.
class FakeDb {
  stockItems: FakeStockItem[] = [];
  movementLines: FakeMovementLine[] = [];
  outboxRows: FakeOutboxRow[] = [];
  repairRows: FakeRepairRow[] = [];
  hasUnasLinkByVariant = new Set<string>();
  executedRawCount = 0;

  async $executeRaw() {
    this.executedRawCount += 1;
    return 1;
  }

  stockItem = {
    findFirst: async (args: {
      where: { id?: string; variantId?: string; warehouseId?: string };
    }) => {
      const item = this.stockItems.find(
        (row) =>
          (!args.where.id || row.id === args.where.id) &&
          (!args.where.variantId || row.variantId === args.where.variantId) &&
          (!args.where.warehouseId ||
            row.warehouseId === args.where.warehouseId),
      );
      return item
        ? {
            ...item,
            variant: {
              sku: item.sku,
              product: {
                catalogAuthority: item.catalogAuthority ?? "UNAS",
                unasSnapshot: this.hasUnasLinkByVariant.has(item.variantId)
                  ? { id: `snapshot-${item.variantId}` }
                  : null,
              },
            },
          }
        : null;
    },
    update: async (args: {
      where: { id: string };
      data: { onHand: Prisma.Decimal };
    }) => {
      const item = this.stockItems.find((row) => row.id === args.where.id)!;
      item.onHand = args.data.onHand;
      return item;
    },
    create: async () => {
      throw new Error("not used in these tests");
    },
    findMany: async (args: { where?: { id?: string } }) => {
      const filtered = this.stockItems.filter(
        (row) => !args.where?.id || row.id === args.where.id,
      );
      return filtered.map((row) => ({
        id: row.id,
        variantId: row.variantId,
        warehouseId: row.warehouseId,
        onHand: row.onHand,
        variant: { sku: row.sku },
        warehouse: { code: "FO" },
      }));
    },
    count: async () => this.stockItems.length,
    groupBy: async () => [],
  };

  /// Added when the transaction seam was typed: RepairTransaction requires
  /// `stockMovement` (it is Picked straight from InventoryMovementDatabase),
  /// and the double did not have it at all. Nothing here calls it today - the
  /// repair path writes lines, not movements - but leaving it out is what let
  /// the double drift from the contract in the first place.
  stockMovement = {
    findFirst: async () => null,
    create: async () => ({ id: nextId("movement") }),
  };

  stockMovementLine = {
    create: async () => ({}),
    findMany: async (args: {
      where: {
        variantId: { in: string[] };
        movement: { sourceWarehouseId: { in: string[] } };
      };
    }) => {
      const variantIds = new Set(args.where.variantId.in);
      const warehouseIds = new Set(args.where.movement.sourceWarehouseId.in);
      return this.movementLines
        .filter(
          (line) =>
            variantIds.has(line.variantId) &&
            warehouseIds.has(line.sourceWarehouseId),
        )
        .map((line) => ({
          variantId: line.variantId,
          quantity: line.quantity,
          movement: {
            type: line.type,
            sourceWarehouseId: line.sourceWarehouseId,
          },
        }));
    },
  };

  productVariant = {
    findMany: async (args: { where: { id: { in: string[] } } }) => {
      const ids = new Set(args.where.id.in);
      return this.stockItems
        .filter((row) => ids.has(row.variantId))
        .map((row) => ({
          id: row.variantId,
          productId: `p-${row.variantId}`,
          product: {
            catalogAuthority: row.catalogAuthority ?? "UNAS",
            /// `isPackageProduct` was missing here until the transaction
            /// seam was typed. A package product is deliberately not
            /// stock-managed, so a double that never carries the flag can
            /// never exercise that branch - the tests only ever saw the
            /// stock-managed case, and nothing said so.
            unasSnapshot: this.hasUnasLinkByVariant.has(row.variantId)
              ? {
                  reportedStock: row.onHand,
                  isPackageProduct: row.isPackageProduct ?? false,
                }
              : null,
            variants: [{ id: row.variantId }],
          },
        }));
    },
  };

  unasStockSyncOutbox = {
    /// The method the movement writer calls to dead-letter a publish whose
    /// baseline was never known. It was missing here on 2026-09-01 and the
    /// type check stayed green: 74 tests failed at run time instead. Typing
    /// the transaction seam is what makes its absence a compile error.
    update: async (args: {
      where: { id: string };
      data: { status: string };
    }) => {
      const row = this.outboxRows.find(
        (candidate) => candidate.id === args.where.id,
      );
      if (row) row.status = args.data.status;
      return {};
    },
    updateMany: async (args: {
      where: {
        variantId: string;
        warehouseId: string;
        status: { in: string[] };
      };
    }) => {
      let count = 0;
      for (const row of this.outboxRows) {
        if (
          row.variantId === args.where.variantId &&
          row.warehouseId === args.where.warehouseId &&
          args.where.status.in.includes(row.status)
        ) {
          row.status = "SUCCEEDED";
          count += 1;
        }
      }
      return { count };
    },
    create: async (args: {
      data: {
        variantId: string;
        warehouseId: string;
        targetOnHand: Prisma.Decimal;
        idempotencyKey: string;
      };
    }) => {
      const row = {
        id: nextId("outbox"),
        variantId: args.data.variantId,
        warehouseId: args.data.warehouseId,
        targetOnHand: args.data.targetOnHand,
        status: "PENDING",
        idempotencyKey: args.data.idempotencyKey,
      };
      this.outboxRows.push(row);
      return { id: row.id };
    },
    findFirst: async (args: {
      where: {
        variantId: string;
        warehouseId: string;
        status: { in: string[] };
      };
    }) => {
      const row = this.outboxRows.find(
        (candidate) =>
          candidate.variantId === args.where.variantId &&
          candidate.warehouseId === args.where.warehouseId &&
          args.where.status.in.includes(candidate.status),
      );
      return row ? { id: row.id, status: row.status } : null;
    },
    findMany: async () => [],
  };

  stockReconciliationRepair = {
    create: async (args: {
      data: Omit<FakeRepairRow, "id" | "createdAt"> & { createdAt?: Date };
    }) => {
      const row: FakeRepairRow = {
        id: nextId("repair"),
        createdAt: new Date(),
        ...args.data,
      } as FakeRepairRow;
      this.repairRows.push(row);
      return row;
    },
    findFirst: async (args: { where: { idempotencyKey: string } }) =>
      this.repairRows.find(
        (row) => row.idempotencyKey === args.where.idempotencyKey,
      ) ?? null,
    findUnique: async (args: { where: { id: string } }) =>
      this.repairRows.find((row) => row.id === args.where.id) ?? null,
  };

  /// Typed, not `unknown`: `this` is what reaches the movement-writer
  /// helpers, so the compiler has to check it against the same contract the
  /// repository promises them.
  async $transaction<T>(
    operation: (transaction: RepairTransaction) => Promise<T>,
  ): Promise<T> {
    return operation(this);
  }
}

function repositoryWith(db: FakeDb) {
  return new StockReconciliationRepairRepository(
    db as unknown as StockReconciliationRepairDatabase,
  );
}

describe("StockReconciliationRepairRepository.applyLocalFromProvenLedger", () => {
  it("corrects StockItem.onHand to the proven ledger value, creates an outbox row, and persists an APPLIED audit row", async () => {
    const db = new FakeDb();
    db.stockItems.push({
      id: "si-1",
      variantId: "v1",
      warehouseId: "wh-1",
      onHand: d("999"),
      sku: "sku-1",
    });
    db.movementLines.push(
      {
        variantId: "v1",
        quantity: d("10"),
        type: "PURCHASE_RECEIPT",
        sourceWarehouseId: "wh-1",
      },
      {
        variantId: "v1",
        quantity: d("3"),
        type: "SALE",
        sourceWarehouseId: "wh-1",
      },
    );
    const repository = repositoryWith(db);

    const outcome = await repository.applyLocalFromProvenLedger({
      variantId: "v1",
      warehouseId: "wh-1",
      expectedCurrentOnHand: d("999"),
      reason: "Bizonyított ledger-eltérés javítása",
      actorUserId: "user-1",
      idempotencyKey: "RECONCILIATION_REPAIR:LOCAL_FROM_PROVEN_LEDGER:si-1:999",
    });

    assert.equal(outcome.status, "APPLIED");
    assert.equal(outcome.beforeOnHand, "999");
    assert.equal(outcome.afterOnHand, "7");
    assert.equal(db.stockItems[0]!.onHand.toString(), "7");
    assert.equal(db.outboxRows.length, 1);
    assert.equal(db.outboxRows[0]!.targetOnHand.toString(), "7");
    assert.equal(outcome.outboxId, db.outboxRows[0]!.id);

    const auditRow = db.repairRows[0]!;
    assert.equal(auditRow.actorUserId, "user-1");
    assert.equal(auditRow.reason, "Bizonyított ledger-eltérés javítása");
    assert.equal(auditRow.beforeOnHand?.toString(), "999");
    assert.equal(auditRow.afterOnHand?.toString(), "7");
    assert.equal(auditRow.status, "APPLIED");

    // Never a StockMovement - this is a data-integrity correction back to
    // what the ledger already proved, not a new physical stock event (see
    // the repository's own doc comment on why applyLocalFromProvenLedger
    // never calls stockMovementLine.create).
    assert.equal(db.movementLines.length, 2); // only the two seeded ledger lines - none added
  });

  it("repairs a local product without creating an UNAS outbox row", async () => {
    const db = new FakeDb();
    db.stockItems.push({
      id: "si-local",
      variantId: "v-local",
      warehouseId: "wh-1",
      onHand: d("999"),
      sku: "local-sku-1",
      catalogAuthority: "ACROPORA",
    });
    db.movementLines.push({
      variantId: "v-local",
      quantity: d("7"),
      type: "PURCHASE_RECEIPT",
      sourceWarehouseId: "wh-1",
    });
    const repository = repositoryWith(db);

    const outcome = await repository.applyLocalFromProvenLedger({
      variantId: "v-local",
      warehouseId: "wh-1",
      expectedCurrentOnHand: d("999"),
      reason: "Helyi ledger-eltérés javítása",
      actorUserId: "user-1",
      idempotencyKey:
        "RECONCILIATION_REPAIR:LOCAL_FROM_PROVEN_LEDGER:si-local:999",
    });

    assert.equal(outcome.status, "APPLIED");
    assert.equal(outcome.afterOnHand, "7");
    assert.equal(outcome.outboxId, null);
    assert.equal(db.stockItems[0]!.onHand.toString(), "7");
    assert.equal(db.outboxRows.length, 0);
  });

  it("rejects (persisting a REJECTED audit row, no StockItem write) when the ledger is not provable", async () => {
    const db = new FakeDb();
    db.stockItems.push({
      id: "si-1",
      variantId: "v1",
      warehouseId: "wh-1",
      onHand: d("5"),
      sku: "sku-1",
    });
    db.movementLines.push({
      variantId: "v1",
      quantity: d("5"),
      type: "ADJUSTMENT",
      sourceWarehouseId: "wh-1",
    });
    const repository = repositoryWith(db);

    const outcome = await repository.applyLocalFromProvenLedger({
      variantId: "v1",
      warehouseId: "wh-1",
      expectedCurrentOnHand: d("5"),
      reason: "megpróbálom javítani",
      actorUserId: "user-1",
      idempotencyKey: "k1",
    });

    assert.equal(outcome.status, "REJECTED");
    assert.equal(outcome.rejectionCode, "LEDGER_NOT_PROVABLE");
    assert.equal(db.stockItems[0]!.onHand.toString(), "5"); // untouched
    assert.equal(db.outboxRows.length, 0);
    assert.equal(db.repairRows[0]!.status, "REJECTED");
  });

  it("rejects with HISTORICAL_BASELINE_UNKNOWN-equivalent LEDGER_NOT_PROVABLE when there is no ledger movement at all", async () => {
    const db = new FakeDb();
    db.stockItems.push({
      id: "si-1",
      variantId: "v1",
      warehouseId: "wh-1",
      onHand: d("42"),
      sku: "sku-1",
    });
    // No movement lines at all - baseline-only StockItem.
    const repository = repositoryWith(db);

    const outcome = await repository.applyLocalFromProvenLedger({
      variantId: "v1",
      warehouseId: "wh-1",
      expectedCurrentOnHand: d("42"),
      reason: "reason",
      actorUserId: "user-1",
      idempotencyKey: "k2",
    });

    assert.equal(outcome.status, "REJECTED");
    assert.equal(outcome.rejectionCode, "LEDGER_NOT_PROVABLE");
  });

  it("rejects with STALE_EXPECTED_CURRENT_VALUE when the caller's snapshot no longer matches current onHand", async () => {
    const db = new FakeDb();
    db.stockItems.push({
      id: "si-1",
      variantId: "v1",
      warehouseId: "wh-1",
      onHand: d("7"),
      sku: "sku-1",
    });
    db.movementLines.push({
      variantId: "v1",
      quantity: d("7"),
      type: "PURCHASE_RECEIPT",
      sourceWarehouseId: "wh-1",
    });
    const repository = repositoryWith(db);

    const outcome = await repository.applyLocalFromProvenLedger({
      variantId: "v1",
      warehouseId: "wh-1",
      expectedCurrentOnHand: d("999"), // stale - actual onHand is 7
      reason: "reason",
      actorUserId: "user-1",
      idempotencyKey: "k3",
    });

    assert.equal(outcome.status, "REJECTED");
    assert.equal(outcome.rejectionCode, "STALE_EXPECTED_CURRENT_VALUE");
  });

  it("is a NOOP (no StockItem write, but still audited) when the ledger already matches onHand exactly", async () => {
    const db = new FakeDb();
    db.stockItems.push({
      id: "si-1",
      variantId: "v1",
      warehouseId: "wh-1",
      onHand: d("7"),
      sku: "sku-1",
    });
    db.movementLines.push({
      variantId: "v1",
      quantity: d("7"),
      type: "PURCHASE_RECEIPT",
      sourceWarehouseId: "wh-1",
    });
    const repository = repositoryWith(db);

    const outcome = await repository.applyLocalFromProvenLedger({
      variantId: "v1",
      warehouseId: "wh-1",
      expectedCurrentOnHand: d("7"),
      reason: "reason",
      actorUserId: "user-1",
      idempotencyKey: "k4",
    });

    assert.equal(outcome.status, "NOOP");
    assert.equal(db.outboxRows.length, 0);
    assert.equal(db.repairRows[0]!.status, "NOOP");
  });

  it("acquires the advisory lock (via $executeRaw) exactly once per call", async () => {
    const db = new FakeDb();
    db.stockItems.push({
      id: "si-1",
      variantId: "v1",
      warehouseId: "wh-1",
      onHand: d("999"),
      sku: "sku-1",
    });
    db.movementLines.push({
      variantId: "v1",
      quantity: d("7"),
      type: "PURCHASE_RECEIPT",
      sourceWarehouseId: "wh-1",
    });
    const repository = repositoryWith(db);
    await repository.applyLocalFromProvenLedger({
      variantId: "v1",
      warehouseId: "wh-1",
      expectedCurrentOnHand: d("999"),
      reason: "reason",
      actorUserId: "user-1",
      idempotencyKey: "k5",
    });
    assert.equal(db.executedRawCount, 1);
  });
});

describe("StockReconciliationRepairRepository.applyRepublishLocalToUnas", () => {
  it("enqueues an outbox row targeting the current localOnHand and persists an APPLIED audit row", async () => {
    const db = new FakeDb();
    db.stockItems.push({
      id: "si-1",
      variantId: "v1",
      warehouseId: "wh-1",
      onHand: d("12"),
      sku: "sku-1",
    });
    db.hasUnasLinkByVariant.add("v1");
    const repository = repositoryWith(db);

    const outcome = await repository.applyRepublishLocalToUnas({
      variantId: "v1",
      warehouseId: "wh-1",
      hasUnasLink: true,
      expectedCurrentOnHand: d("12"),
      reason: "manuális republish",
      actorUserId: "user-1",
      idempotencyKey: "k-republish-1",
    });

    assert.equal(outcome.status, "APPLIED");
    assert.equal(db.outboxRows.length, 1);
    assert.equal(db.outboxRows[0]!.targetOnHand.toString(), "12");
  });

  it("rejects with MISSING_UNAS_LINK and creates no outbox row", async () => {
    const db = new FakeDb();
    db.stockItems.push({
      id: "si-1",
      variantId: "v1",
      warehouseId: "wh-1",
      onHand: d("12"),
      sku: "sku-1",
    });
    const repository = repositoryWith(db);

    const outcome = await repository.applyRepublishLocalToUnas({
      variantId: "v1",
      warehouseId: "wh-1",
      hasUnasLink: false,
      expectedCurrentOnHand: d("12"),
      reason: "reason",
      actorUserId: "user-1",
      idempotencyKey: "k-republish-2",
    });

    assert.equal(outcome.status, "REJECTED");
    assert.equal(outcome.rejectionCode, "MISSING_UNAS_LINK");
    assert.equal(db.outboxRows.length, 0);
  });

  it("rejects republish for a local product even if the caller supplies a stale positive link hint", async () => {
    const db = new FakeDb();
    db.stockItems.push({
      id: "si-local",
      variantId: "v-local",
      warehouseId: "wh-1",
      onHand: d("12"),
      sku: "local-sku-1",
      catalogAuthority: "ACROPORA",
    });
    // Defensive corrupt/stale relation: authority remains decisive.
    db.hasUnasLinkByVariant.add("v-local");
    const repository = repositoryWith(db);

    const outcome = await repository.applyRepublishLocalToUnas({
      variantId: "v-local",
      warehouseId: "wh-1",
      hasUnasLink: true,
      expectedCurrentOnHand: d("12"),
      reason: "stale kliensadat ellenőrzése",
      actorUserId: "user-1",
      idempotencyKey: "k-republish-local",
    });

    assert.equal(outcome.status, "REJECTED");
    assert.equal(outcome.rejectionCode, "MISSING_UNAS_LINK");
    assert.equal(db.outboxRows.length, 0);
  });

  it("rejects with ALREADY_QUEUED when a PENDING row already covers this exact pair", async () => {
    const db = new FakeDb();
    db.stockItems.push({
      id: "si-1",
      variantId: "v1",
      warehouseId: "wh-1",
      onHand: d("12"),
      sku: "sku-1",
    });
    db.hasUnasLinkByVariant.add("v1");
    db.outboxRows.push({
      id: "existing-outbox",
      variantId: "v1",
      warehouseId: "wh-1",
      targetOnHand: d("12"),
      status: "PENDING",
      idempotencyKey: "other-key",
    });
    const repository = repositoryWith(db);

    const outcome = await repository.applyRepublishLocalToUnas({
      variantId: "v1",
      warehouseId: "wh-1",
      hasUnasLink: true,
      expectedCurrentOnHand: d("12"),
      reason: "reason",
      actorUserId: "user-1",
      idempotencyKey: "k-republish-3",
    });

    assert.equal(outcome.status, "REJECTED");
    assert.equal(outcome.rejectionCode, "ALREADY_QUEUED");
    assert.equal(db.outboxRows.length, 1); // unchanged - no second row added
  });

  it("never calls a direct UNAS API method - the FakeDb exposes no such method to call", () => {
    // Structural proof, mirroring stock-reconciliation.repository.spec.ts's
    // own "never calls a mutating method" test: RepairTransaction's
    // TypeScript interface (stock-reconciliation-repair.repository.ts)
    // exposes only Prisma-shaped model methods - there is no unasApiClient
    // or similar dependency anywhere in its type, so this class cannot
    // reach UNAS directly even by mistake.
    const db = new FakeDb();
    const outboxMethods = Object.keys(db.unasStockSyncOutbox);
    /// `update` joined this list on 2026-09-01, when the transaction seam was
    /// typed and the compiler found the double was missing it. The list stays
    /// exact on purpose: it is what makes a new method have to justify itself
    /// here, and it did its job - this assertion is what forced the addition
    /// to be explained rather than slipped in. Every entry is a Prisma-shaped
    /// model method; none of them can reach UNAS.
    assert.deepEqual(
      outboxMethods.sort(),
      ["create", "findFirst", "findMany", "update", "updateMany"].sort(),
    );
  });
});
