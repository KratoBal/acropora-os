import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@acropora/database";

import {
  InventoryCountRepository,
  type InventoryCountDatabase,
} from "./inventory-count.repository.js";

interface FakeLine {
  id: string;
  variantId: string;
  expectedQty: Prisma.Decimal;
  countedQty: Prisma.Decimal | null;
  syncStatus: string;
  syncError: string | null;
  variant: {
    sku: string;
    unit: string;
    product: {
      name: string;
      catalogAuthority: "UNAS" | "ACROPORA" | null;
      unasSnapshot?: { isPackageProduct: boolean } | null;
    };
  };
}

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

/// Fake exercising InventoryCountRepository.applyCorrection() end to end,
/// including the shared postInventoryMovement() primitive (this repository
/// no longer has its own StockMovement/StockItem-writing code - it's all in
/// inventory-movement-writer.ts). Note this in-memory double can prove
/// *ordering* (e.g. the leltár is only marked CORRECTED after all lines are
/// processed) but not genuine cross-statement rollback - that's a real
/// Postgres transaction guarantee, checked instead by
/// inventory-movement-writer.spec.ts's unit tests of the shared primitive
/// plus a real DB integration test would be needed for full end-to-end
/// proof (none exists yet for this specific flow - see the checkpoint
/// report's "known limits").
class FakeDb {
  warehouseId = "wh-1";
  lines: FakeLine[] = [];
  inventoryCountLineFindManyArgs: any;
  stockItems: Array<{ id: string; variantId: string; onHand: Prisma.Decimal }> =
    [];
  movements: Array<{ id: string; idempotencyKey: string | null }> = [];
  movementLines: Array<{ variantId: string; quantity: Prisma.Decimal }> = [];
  outbox: Array<{
    id: string;
    variantId: string;
    warehouseId: string;
    status: string;
    idempotencyKey: string;
    targetOnHand: Prisma.Decimal;
  }> = [];
  count = {
    id: "count-1",
    countNumber: "LELTAR-1",
    warehouseId: this.warehouseId,
    status: "UPLOADED",
    createdAt: new Date("2026-07-20T10:00:00.000Z"),
    uploadedAt: new Date("2026-07-20T10:05:00.000Z"),
    correctedAt: null as Date | null,
  };

  inventoryCount = {
    findUnique: async () => ({
      ...this.count,
      warehouse: { name: "Fő raktár" },
      startedBy: null,
      lines: this.lines,
    }),
    update: async (args: any) => {
      Object.assign(this.count, args.data);
      return {
        ...this.count,
        warehouse: { name: "Fő raktár" },
        startedBy: null,
        lines: this.lines,
      };
    },
    create: async () => {
      throw new Error("not used in these tests");
    },
    findMany: async () => [],
    count: async () => 0,
  };

  inventoryCountLine = {
    findMany: async (args: any) => {
      this.inventoryCountLineFindManyArgs = args;
      return this.lines;
    },
    update: async (args: any) => {
      const line = this.lines.find((l) => l.id === args.where.id)!;
      Object.assign(line, args.data);
      return line;
    },
    updateMany: async () => ({ count: 0 }),
  };

  stockItem = {
    findMany: async (args: any) => {
      const ids: string[] = args.where.variantId.in;
      return this.stockItems
        .filter((item) => ids.includes(item.variantId))
        .map((item) => ({ variantId: item.variantId, onHand: item.onHand }));
    },
    findFirst: async (args: any) => {
      const item = this.stockItems.find(
        (stockItem) => stockItem.variantId === args.where.variantId,
      );
      return item ? { id: item.id, onHand: item.onHand } : null;
    },
    update: async (args: any) => {
      const item = this.stockItems.find((s) => s.id === args.where.id)!;
      item.onHand = args.data.onHand;
      return item;
    },
    create: async (args: any) => {
      const item = {
        id: nextId("stock"),
        variantId: args.data.variantId as string,
        onHand: args.data.onHand as Prisma.Decimal,
      };
      this.stockItems.push(item);
      return item;
    },
  };

  stockMovement = {
    findFirst: async (args: any) => {
      const found = this.movements.find(
        (m) => m.idempotencyKey === args.where.idempotencyKey,
      );
      return found ? { id: found.id } : null;
    },
    create: async (args: any) => {
      const movement = {
        id: nextId("movement"),
        idempotencyKey: args.data.idempotencyKey ?? null,
      };
      this.movements.push(movement);
      return movement;
    },
  };

  stockMovementLine = {
    create: async (args: any) => {
      this.movementLines.push({
        variantId: args.data.variantId,
        quantity: args.data.quantity,
      });
      return {};
    },
  };

  unasStockSyncOutbox = {
    /// No prior baseline-unknown row in these fixtures: the movement writer
    /// asks before every publish, and these tests are not about that guard.
    findFirst: async () => null,
    /// Closes a single row by id. The writer uses it to dead-letter a publish
    /// whose baseline was never known; these fixtures start from an empty
    /// warehouse, so their rows take that path.
    update: async (args: any) => {
      const row = this.outbox.find(
        (candidate: any) => candidate.id === args.where.id,
      );
      if (row) {
        row.status = args.data.status;
      }
      return {};
    },
    updateMany: async (args: any) => {
      let count = 0;
      for (const row of this.outbox) {
        if (
          row.variantId === args.where.variantId &&
          row.warehouseId === args.where.warehouseId &&
          args.where.status.in.includes(row.status)
        ) {
          row.status = args.data.status;
          count += 1;
        }
      }
      return { count };
    },
    create: async (args: any) => {
      this.outbox.push({
        id: nextId("outbox"),
        variantId: args.data.variantId,
        warehouseId: args.data.warehouseId,
        status: "PENDING",
        idempotencyKey: args.data.idempotencyKey,
        targetOnHand: args.data.targetOnHand,
      });
      return {};
    },
  };

  async $executeRaw() {
    return 1;
  }

  warehouse = {
    findFirst: async () => ({ id: this.warehouseId, name: "Fő raktár" }),
    create: async () => ({ id: this.warehouseId, name: "Fő raktár" }),
  };

  productVariant = { findMany: async () => [] };

  async $transaction<T>(operation: (transaction: any) => Promise<T>) {
    return operation(this);
  }
}

function repositoryWith(db: FakeDb) {
  return new InventoryCountRepository(db as unknown as InventoryCountDatabase);
}

describe("InventoryCountRepository.applyCorrection", () => {
  it("creates an ADJUSTMENT movement, updates StockItem, and creates exactly one outbox row when the count differs from expected", async () => {
    const db = new FakeDb();
    db.lines.push({
      id: "line-1",
      variantId: "variant-1",
      expectedQty: new Prisma.Decimal("10"),
      countedQty: new Prisma.Decimal("8"),
      syncStatus: "PENDING",
      syncError: null,
      variant: {
        sku: "sku-1",
        unit: "db",
        product: { name: "Reef Pump", catalogAuthority: "UNAS" },
      },
    });

    const repository = repositoryWith(db);
    const result = await repository.applyCorrection("count-1", "user-1");

    assert.equal(db.movementLines.length, 1);
    assert.equal(db.movementLines[0]?.quantity.toString(), "2"); // stored as abs(delta)
    assert.equal(db.stockItems.length, 1);
    assert.equal(db.stockItems[0]?.onHand.toString(), "8");
    assert.equal(db.outbox.length, 1);
    assert.equal(db.outbox[0]?.targetOnHand.toString(), "8");
    assert.equal(db.lines[0]?.syncStatus, "PENDING");
    assert.equal(result.successCount, 1);
    assert.equal(result.failedCount, 0);
    assert.equal(db.count.status, "CORRECTED");
    assert.deepEqual(
      db.inventoryCountLineFindManyArgs.include.variant.select.product,
      {
        select: {
          catalogAuthority: true,
          unasSnapshot: { select: { isPackageProduct: true } },
        },
      },
      "the correction query must load catalogAuthority before deciding whether to sync to UNAS",
    );
  });

  it("never applies an independent inventory correction to a package product", async () => {
    const db = new FakeDb();
    db.lines.push({
      id: "line-package",
      variantId: "variant-package",
      expectedQty: new Prisma.Decimal("5"),
      countedQty: new Prisma.Decimal("0"),
      syncStatus: "PENDING",
      syncError: null,
      variant: {
        sku: "BUNDLE-1",
        unit: "db",
        product: {
          name: "Csomagtermék",
          catalogAuthority: "UNAS",
          unasSnapshot: { isPackageProduct: true },
        },
      },
    });

    await repositoryWith(db).applyCorrection("count-1", "user-1");

    assert.equal(db.movementLines.length, 0);
    assert.equal(db.stockItems.length, 0);
    assert.equal(db.outbox.length, 0);
  });

  it("corrects a local product's stock without creating an UNAS outbox row", async () => {
    const db = new FakeDb();
    db.lines.push({
      id: "line-local-1",
      variantId: "variant-local-1",
      expectedQty: new Prisma.Decimal("5"),
      countedQty: new Prisma.Decimal("4"),
      syncStatus: "PENDING",
      syncError: null,
      variant: {
        sku: "LOCAL-1",
        unit: "db",
        product: { name: "Helyi termék", catalogAuthority: "ACROPORA" },
      },
    });

    await repositoryWith(db).applyCorrection("count-1", "user-1");

    assert.equal(db.movementLines.length, 1);
    assert.equal(db.stockItems[0]?.onHand.toString(), "4");
    assert.equal(db.outbox.length, 0);
  });

  it("rejects (does not double-book) when the same leltár is applied a second time via a fresh call with the same idempotency key", async () => {
    const db = new FakeDb();
    db.lines.push({
      id: "line-1",
      variantId: "variant-1",
      expectedQty: new Prisma.Decimal("10"),
      countedQty: new Prisma.Decimal("8"),
      syncStatus: "PENDING",
      syncError: null,
      variant: {
        sku: "sku-1",
        unit: "db",
        product: { name: "Reef Pump", catalogAuthority: "UNAS" },
      },
    });
    const repository = repositoryWith(db);
    await repository.applyCorrection("count-1", "user-1");
    assert.equal(db.movements.length, 1);

    // Simulate a second concurrent call reaching this method again for the
    // same count id before the service-layer status guard would normally
    // stop it (see inventory-count.service.ts) - the repository's own
    // idempotency check must still catch it.
    await assert.rejects(
      () => repository.applyCorrection("count-1", "user-1"),
      /már lekönyvelte/,
    );
    assert.equal(db.movements.length, 1, "no second movement was created");
    assert.equal(db.outbox.length, 1, "no second outbox row was created");
  });

  // This is the exact scenario Balázs hit: UNAS shows 4 in stock, the leltár
  // was created before any local StockItem row existed for this variant, so
  // its "current" (expected) value fell back to the UNAS-reported 4 - and
  // counting 4 too meant the naive "no numeric difference" check used to
  // skip creating a local StockItem row entirely, leaving /products stuck
  // showing "—" forever even though the product had just been counted.
  it("still creates a StockItem baseline (without a movement or outbox row) when the count matches expected but no StockItem row exists yet", async () => {
    const db = new FakeDb();
    db.lines.push({
      id: "line-1",
      variantId: "variant-1",
      expectedQty: new Prisma.Decimal("4"),
      countedQty: new Prisma.Decimal("4"),
      syncStatus: "PENDING",
      syncError: null,
      variant: {
        sku: "AI-PFAN",
        unit: "db",
        product: {
          name: "Aqua Illumination Prime hűtőventillátor",
          catalogAuthority: "UNAS",
        },
      },
    });

    const repository = repositoryWith(db);
    const result = await repository.applyCorrection("count-1", "user-1");

    assert.equal(db.movementLines.length, 0);
    assert.equal(db.stockItems.length, 1);
    assert.equal(db.stockItems[0]?.variantId, "variant-1");
    assert.equal(db.stockItems[0]?.onHand.toString(), "4");
    assert.equal(
      db.outbox.length,
      0,
      "a baseline-only set must not publish to UNAS",
    );
    assert.equal(result.successCount, 1);
    assert.equal(result.failedCount, 0);
  });

  it("does not touch StockItem again when the count matches and a baseline already exists", async () => {
    const db = new FakeDb();
    db.stockItems.push({
      id: "stock-1",
      variantId: "variant-1",
      onHand: new Prisma.Decimal("4"),
    });
    db.lines.push({
      id: "line-1",
      variantId: "variant-1",
      expectedQty: new Prisma.Decimal("4"),
      countedQty: new Prisma.Decimal("4"),
      syncStatus: "PENDING",
      syncError: null,
      variant: {
        sku: "AI-PFAN",
        unit: "db",
        product: {
          name: "Aqua Illumination Prime hűtőventillátor",
          catalogAuthority: "UNAS",
        },
      },
    });

    const repository = repositoryWith(db);
    await repository.applyCorrection("count-1", "user-1");

    assert.equal(db.movementLines.length, 0);
    assert.equal(db.stockItems.length, 1);
    assert.equal(db.stockItems[0]?.onHand.toString(), "4");
  });

  it("still creates a (line-less) movement and returns a movementNumber when nothing changed at all", async () => {
    const db = new FakeDb();
    db.stockItems.push({
      id: "stock-1",
      variantId: "variant-1",
      onHand: new Prisma.Decimal("4"),
    });
    db.lines.push({
      id: "line-1",
      variantId: "variant-1",
      expectedQty: new Prisma.Decimal("4"),
      countedQty: new Prisma.Decimal("4"),
      syncStatus: "PENDING",
      syncError: null,
      variant: {
        sku: "sku-1",
        unit: "db",
        product: { name: "Reef Pump", catalogAuthority: "UNAS" },
      },
    });

    const repository = repositoryWith(db);
    const result = await repository.applyCorrection("count-1", "user-1");

    assert.equal(db.movements.length, 1);
    assert.ok(result.movementNumber.startsWith("KORR-"));
    assert.equal(db.outbox.length, 0);
    assert.equal(db.count.status, "CORRECTED");
  });

  it("handles a multi-line correction: each variant gets its own movement line, StockItem, and outbox row", async () => {
    const db = new FakeDb();
    db.lines.push(
      {
        id: "line-1",
        variantId: "variant-1",
        expectedQty: new Prisma.Decimal("10"),
        countedQty: new Prisma.Decimal("8"),
        syncStatus: "PENDING",
        syncError: null,
        variant: {
          sku: "sku-1",
          unit: "db",
          product: { name: "A", catalogAuthority: "UNAS" },
        },
      },
      {
        id: "line-2",
        variantId: "variant-2",
        expectedQty: new Prisma.Decimal("3"),
        countedQty: new Prisma.Decimal("5"),
        syncStatus: "PENDING",
        syncError: null,
        variant: {
          sku: "sku-2",
          unit: "db",
          product: { name: "B", catalogAuthority: "UNAS" },
        },
      },
    );

    const repository = repositoryWith(db);
    const result = await repository.applyCorrection("count-1", "user-1");

    assert.equal(db.movementLines.length, 2);
    assert.equal(db.stockItems.length, 2);
    assert.equal(db.outbox.length, 2);
    assert.equal(result.successCount, 2);
    assert.equal(
      db.movements.length,
      1,
      "one movement document for the whole leltár, with two lines",
    );
  });

  it("only finalizes the leltár (status CORRECTED) after every line has been processed, never leaving a half-applied state", async () => {
    const db = new FakeDb();
    db.lines.push({
      id: "line-1",
      variantId: "variant-1",
      expectedQty: new Prisma.Decimal("10"),
      countedQty: new Prisma.Decimal("8"),
      syncStatus: "PENDING",
      syncError: null,
      variant: {
        sku: "sku-1",
        unit: "db",
        product: { name: "Reef Pump", catalogAuthority: "UNAS" },
      },
    });
    // Force a failure partway through by breaking stockMovementLine.create.
    const originalCreate = db.stockMovementLine.create;
    let calls = 0;
    db.stockMovementLine.create = async (_args: any) => {
      calls += 1;
      throw new Error("simulated failure");
    };

    const repository = repositoryWith(db);
    await assert.rejects(() => repository.applyCorrection("count-1", "user-1"));

    assert.equal(calls, 1);
    assert.notEqual(
      db.count.status,
      "CORRECTED",
      "the leltár must not be marked CORRECTED when the movement failed to post",
    );
    void originalCreate;
  });
});
