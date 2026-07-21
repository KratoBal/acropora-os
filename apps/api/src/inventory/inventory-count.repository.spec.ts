import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@acropora/database";

import type { InventoryCountLinePushResult } from "./inventory-count.repository.js";
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
  variant: { sku: string; unit: string; product: { name: string } };
}

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

class FakeDb {
  warehouseId = "wh-1";
  lines: FakeLine[] = [];
  stockItems: Array<{ id: string; variantId: string; onHand: Prisma.Decimal }> =
    [];
  movementLines: Array<{ variantId: string; quantity: Prisma.Decimal }> = [];
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
    findMany: async () => this.lines,
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
        .map((item) => ({ variantId: item.variantId }));
    },
    findFirst: async (args: any) => {
      const item = this.stockItems.find(
        (stockItem) => stockItem.variantId === args.where.variantId,
      );
      return item ? { id: item.id } : null;
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
    create: async () => ({ id: nextId("movement"), movementNumber: "KORR-1" }),
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
  it("creates a StockItem baseline and a movement line when the count differs from expected", async () => {
    const db = new FakeDb();
    db.lines.push({
      id: "line-1",
      variantId: "variant-1",
      expectedQty: new Prisma.Decimal("10"),
      countedQty: new Prisma.Decimal("8"),
      syncStatus: "PENDING",
      syncError: null,
      variant: { sku: "sku-1", unit: "db", product: { name: "Reef Pump" } },
    });

    const repository = repositoryWith(db);
    const pushResults = new Map<string, InventoryCountLinePushResult>();
    await repository.applyCorrection("count-1", "user-1", pushResults);

    assert.equal(db.movementLines.length, 1);
    assert.equal(db.movementLines[0]?.quantity.toString(), "-2");
    assert.equal(db.stockItems.length, 1);
    assert.equal(db.stockItems[0]?.onHand.toString(), "8");
  });

  // This is the exact scenario Balázs hit: UNAS shows 4 in stock, the leltár
  // was created before any local StockItem row existed for this variant, so
  // its "current" (expected) value fell back to the UNAS-reported 4 - and
  // counting 4 too meant the naive "no numeric difference" check used to
  // skip creating a local StockItem row entirely, leaving /products stuck
  // showing "—" forever even though the product had just been counted.
  it("still creates a StockItem baseline when the count matches expected but no StockItem row exists yet", async () => {
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
        product: { name: "Aqua Illumination Prime hűtőventillátor" },
      },
    });

    const repository = repositoryWith(db);
    const pushResults = new Map<string, InventoryCountLinePushResult>();
    const result = await repository.applyCorrection(
      "count-1",
      "user-1",
      pushResults,
    );

    assert.equal(db.movementLines.length, 0);
    assert.equal(db.stockItems.length, 1);
    assert.equal(db.stockItems[0]?.variantId, "variant-1");
    assert.equal(db.stockItems[0]?.onHand.toString(), "4");
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
        product: { name: "Aqua Illumination Prime hűtőventillátor" },
      },
    });

    const repository = repositoryWith(db);
    const pushResults = new Map<string, InventoryCountLinePushResult>();
    await repository.applyCorrection("count-1", "user-1", pushResults);

    assert.equal(db.movementLines.length, 0);
    assert.equal(db.stockItems.length, 1);
    assert.equal(db.stockItems[0]?.onHand.toString(), "4");
  });
});
