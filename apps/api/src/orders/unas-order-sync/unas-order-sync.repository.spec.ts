import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@acropora/database";
import type { UnasApiOrder } from "@acropora/types";

import {
  UnasOrderSyncRepository,
  type UnasOrderSyncDatabase,
} from "./unas-order-sync.repository.js";

interface FakeOrderLine {
  id: string;
  variantId: string | null;
  sku: string;
  quantity: Prisma.Decimal;
  syncStatus: string;
  syncError: string | null;
}

interface FakeOrder {
  id: string;
  orderNumber: string;
  status: string;
  lines: FakeOrderLine[];
}

interface FakeMovement {
  id: string;
  movementNumber: string;
  type: string;
  referenceType: string | null;
  referenceId: string | null;
}

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

class FakeDb {
  warehouses: Array<{ id: string; name: string; createdAt: Date }> = [];
  variants: Array<{ id: string; sku: string }> = [];
  stockItems: Array<{
    id: string;
    variantId: string;
    warehouseId: string;
    onHand: Prisma.Decimal;
  }> = [];
  orders: FakeOrder[] = [];
  externalReferences: Array<{
    id: string;
    entityId: string;
    externalId: string;
  }> = [];
  movements: FakeMovement[] = [];
  runs: Array<Record<string, unknown>> = [];
  cursor: Date | null = null;
  products: Array<{
    id: string;
    name: string;
    unasSnapshot: {
      reportedStock: Prisma.Decimal | null;
      reportedStockSyncedAt: Date | null;
    } | null;
    variants: Array<{ id: string; sku: string }>;
  }> = [];

  unasOrderSyncRun = {
    updateMany: async () => ({ count: 0 }),
    create: async (args: any) => {
      const run = {
        id: nextId("run"),
        ordersSeen: 0,
        createdCount: 0,
        updatedCount: 0,
        reversedCount: 0,
        stockMismatchCount: 0,
        errorCode: null,
        ...args.data,
      };
      this.runs.push(run);
      return run;
    },
    findUnique: async (args: any) =>
      this.runs.find((run) => run.id === args.where.id) ?? null,
    findMany: async () => [...this.runs].reverse(),
    findUniqueOrThrow: async (args: any) => {
      const run = this.runs.find((run_) => run_.id === args.where.id);
      if (!run) throw new Error("run not found");
      return run;
    },
    update: async (args: any) => {
      const run = this.runs.find((run_) => run_.id === args.where.id)!;
      Object.assign(run, args.data);
      return run;
    },
  };

  integrationCursor = {
    findUnique: async () =>
      this.cursor ? { lastSuccessfulWindowEnd: this.cursor } : null,
    upsert: async (args: any) => {
      this.cursor = args.create.lastSuccessfulWindowEnd;
      return {};
    },
  };

  warehouse = {
    findFirst: async () => this.warehouses[0] ?? null,
    create: async (args: any) => {
      const warehouse = {
        id: nextId("wh"),
        name: args.data.name as string,
        createdAt: new Date(),
      };
      this.warehouses.push(warehouse);
      return warehouse;
    },
  };

  productVariant = {
    findFirst: async (args: any) => {
      const variant = this.variants.find((v) => v.sku === args.where.sku);
      return variant ? { id: variant.id } : null;
    },
  };

  externalReference = {
    findUnique: async (args: any) => {
      const key = args.where.system_entityType_externalId;
      const found = this.externalReferences.find(
        (reference) => reference.externalId === key.externalId,
      );
      return found ? { id: found.id, entityId: found.entityId } : null;
    },
    create: async (args: any) => {
      const row = {
        id: nextId("ref"),
        entityId: args.data.entityId as string,
        externalId: args.data.externalId as string,
      };
      this.externalReferences.push(row);
      return row;
    },
    update: async () => ({}),
  };

  salesOrder = {
    create: async (args: any) => {
      const lines: FakeOrderLine[] = (args.data.lines?.create ?? []).map(
        (line: any) => ({
          id: nextId("line"),
          variantId: line.variantId,
          sku: line.sku,
          quantity: line.quantity,
          syncStatus: line.syncStatus,
          syncError: line.syncError,
        }),
      );
      const order: FakeOrder = {
        id: nextId("order"),
        orderNumber: args.data.orderNumber as string,
        status: args.data.status as string,
        lines,
      };
      this.orders.push(order);
      return { id: order.id };
    },
    update: async (args: any) => {
      const order = this.orders.find((o) => o.id === args.where.id)!;
      Object.assign(order, args.data);
      return order;
    },
    findUnique: async (args: any) => {
      const order = this.orders.find((o) => o.id === args.where.id);
      if (!order) return null;
      return {
        id: order.id,
        status: order.status,
        lines: order.lines.map((line) => ({
          id: line.id,
          variantId: line.variantId,
          quantity: line.quantity,
          syncStatus: line.syncStatus,
        })),
      };
    },
    findMany: async () => [],
    count: async () => this.orders.length,
  };

  stockMovement = {
    create: async (args: any) => {
      const movement: FakeMovement = {
        id: nextId("movement"),
        movementNumber: args.data.movementNumber as string,
        type: args.data.type as string,
        referenceType: (args.data.referenceType as string) ?? null,
        referenceId: (args.data.referenceId as string) ?? null,
      };
      this.movements.push(movement);
      return { id: movement.id };
    },
    findFirst: async (args: any) => {
      const found = this.movements.find(
        (movement) =>
          movement.type === args.where.type &&
          movement.referenceType === args.where.referenceType &&
          movement.referenceId === args.where.referenceId,
      );
      return found ? { id: found.id } : null;
    },
  };

  stockMovementLine = {
    create: async () => ({}),
  };

  stockItem = {
    findFirst: async (args: any) => {
      const item = this.stockItems.find(
        (stockItem) =>
          stockItem.variantId === args.where.variantId &&
          stockItem.warehouseId === args.where.warehouseId,
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
        warehouseId: args.data.warehouseId as string,
        onHand: args.data.onHand as Prisma.Decimal,
      };
      this.stockItems.push(item);
      return item;
    },
    findMany: async (args: any) => {
      const ids: string[] = args.where.variantId.in;
      return this.stockItems
        .filter((item) => ids.includes(item.variantId))
        .map((item) => ({ variantId: item.variantId, onHand: item.onHand }));
    },
  };

  product = {
    findMany: async () => this.products,
  };

  async $transaction<T>(operation: (transaction: any) => Promise<T>) {
    return operation(this);
  }
}

function baseOrder(overrides: Partial<UnasApiOrder> = {}): UnasApiOrder {
  return {
    key: "UN-1",
    internalKey: null,
    status: "Feldolgozás alatt",
    statusType: "open_normal",
    statusId: "3",
    orderedAt: "2026-07-20T14:05:00.000Z",
    customerName: "Kovács Anna",
    customerEmail: "vevo@example.com",
    currency: "HUF",
    sumPriceGross: "12700",
    items: [
      {
        id: "1",
        sku: "pump_1",
        name: "Reef Pump",
        unit: "db",
        quantity: "2",
        priceNet: "5000",
        priceGross: "6350",
        vatRate: "27",
      },
      {
        id: "shipping-cost",
        sku: null,
        name: "Szállítás",
        unit: "db",
        quantity: "1",
        priceNet: "0",
        priceGross: "0",
        vatRate: null,
      },
    ],
    ...overrides,
  };
}

function repositoryWith(db: FakeDb) {
  return new UnasOrderSyncRepository(db as unknown as UnasOrderSyncDatabase);
}

describe("UnasOrderSyncRepository.apply", () => {
  it("creates a new order, decrements stock, and skips non-stock lines", async () => {
    const db = new FakeDb();
    db.warehouses.push({
      id: "wh-1",
      name: "Fő raktár",
      createdAt: new Date(0),
    });
    db.variants.push({ id: "variant-1", sku: "pump_1" });
    db.stockItems.push({
      id: "stock-1",
      variantId: "variant-1",
      warehouseId: "wh-1",
      onHand: new Prisma.Decimal(10),
    });
    db.runs.push({ id: "run-1", status: "RUNNING", activeKey: "UNAS_ORDERS" });

    const repository = repositoryWith(db);
    const summary = await repository.apply(
      "run-1",
      [baseOrder()],
      null,
      new Date("2026-07-20T15:00:00.000Z"),
    );

    assert.equal(summary.createdCount, 1);
    assert.equal(db.orders.length, 1);
    assert.equal(db.orders[0]?.orderNumber, "UNAS-UN-1");
    assert.equal(db.orders[0]?.lines.length, 2);
    assert.equal(db.stockItems[0]?.onHand.toString(), "8");
    assert.equal(db.movements.length, 1);
    assert.equal(db.movements[0]?.type, "SALE");
    assert.equal(db.externalReferences.length, 1);
  });

  it("flags an unknown SKU as FAILED without touching stock for it", async () => {
    const db = new FakeDb();
    db.warehouses.push({
      id: "wh-1",
      name: "Fő raktár",
      createdAt: new Date(0),
    });
    db.runs.push({ id: "run-1", status: "RUNNING", activeKey: "UNAS_ORDERS" });

    const repository = repositoryWith(db);
    const order = baseOrder({
      items: [
        {
          id: "1",
          sku: "no_such_sku",
          name: "Ismeretlen tétel",
          unit: "db",
          quantity: "1",
          priceNet: "1000",
          priceGross: "1270",
          vatRate: "27",
        },
      ],
    });

    await repository.apply("run-1", [order], null, new Date());

    assert.equal(db.orders[0]?.lines[0]?.syncStatus, "FAILED");
    assert.equal(db.orders[0]?.lines[0]?.syncError, "UNKNOWN_SKU:no_such_sku");
    assert.equal(db.movements.length, 0);
  });

  it("updates the mirrored status without touching stock on a later sighting", async () => {
    const db = new FakeDb();
    db.warehouses.push({
      id: "wh-1",
      name: "Fő raktár",
      createdAt: new Date(0),
    });
    db.variants.push({ id: "variant-1", sku: "pump_1" });
    db.stockItems.push({
      id: "stock-1",
      variantId: "variant-1",
      warehouseId: "wh-1",
      onHand: new Prisma.Decimal(10),
    });
    db.runs.push({ id: "run-1", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    const repository = repositoryWith(db);
    await repository.apply("run-1", [baseOrder()], null, new Date());

    db.runs.push({ id: "run-2", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    const summary = await repository.apply(
      "run-2",
      [baseOrder({ statusType: "close_ok", status: "Lezárva" })],
      null,
      new Date(),
    );

    assert.equal(summary.createdCount, 0);
    assert.equal(summary.updatedCount, 1);
    assert.equal(db.orders[0]?.status, "COMPLETED");
    assert.equal(db.stockItems[0]?.onHand.toString(), "8");
  });

  it("reverses stock exactly once when an order transitions to cancelled", async () => {
    const db = new FakeDb();
    db.warehouses.push({
      id: "wh-1",
      name: "Fő raktár",
      createdAt: new Date(0),
    });
    db.variants.push({ id: "variant-1", sku: "pump_1" });
    db.stockItems.push({
      id: "stock-1",
      variantId: "variant-1",
      warehouseId: "wh-1",
      onHand: new Prisma.Decimal(10),
    });
    db.runs.push({ id: "run-1", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    const repository = repositoryWith(db);
    await repository.apply("run-1", [baseOrder()], null, new Date());
    assert.equal(db.stockItems[0]?.onHand.toString(), "8");

    db.runs.push({ id: "run-2", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    const cancelled = baseOrder({
      statusType: "close_fault",
      status: "Sztornó",
    });
    const summary = await repository.apply(
      "run-2",
      [cancelled],
      null,
      new Date(),
    );

    assert.equal(summary.reversedCount, 1);
    assert.equal(db.orders[0]?.status, "CANCELLED");
    assert.equal(db.stockItems[0]?.onHand.toString(), "10");
    assert.equal(
      db.movements.some((movement) => movement.type === "RETURN_IN"),
      true,
    );

    // Re-processing the same cancelled order (e.g. a later admin comment
    // bumps its DateMod again) must not reverse stock a second time.
    db.runs.push({ id: "run-3", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    const summaryAgain = await repository.apply(
      "run-3",
      [cancelled],
      null,
      new Date(),
    );
    assert.equal(summaryAgain.reversedCount, 0);
    assert.equal(db.stockItems[0]?.onHand.toString(), "10");
  });
});

describe("UnasOrderSyncRepository.findStockDiscrepancies", () => {
  it("flags variants whose local stock differs from the UNAS reported stock", async () => {
    const db = new FakeDb();
    db.products.push({
      id: "p1",
      name: "Reef Pump",
      unasSnapshot: {
        reportedStock: new Prisma.Decimal(5),
        reportedStockSyncedAt: new Date("2026-07-20T00:00:00.000Z"),
      },
      variants: [{ id: "variant-1", sku: "pump_1" }],
    });
    db.products.push({
      id: "p2",
      name: "Filter",
      unasSnapshot: {
        reportedStock: new Prisma.Decimal(3),
        reportedStockSyncedAt: new Date(),
      },
      variants: [{ id: "variant-2", sku: "filter_1" }],
    });
    db.stockItems.push({
      id: "s1",
      variantId: "variant-1",
      warehouseId: "wh-1",
      onHand: new Prisma.Decimal(8),
    });
    db.stockItems.push({
      id: "s2",
      variantId: "variant-2",
      warehouseId: "wh-1",
      onHand: new Prisma.Decimal(3),
    });

    const repository = repositoryWith(db);
    const report = await repository.findStockDiscrepancies();

    assert.equal(report.checkedCount, 2);
    assert.equal(report.mismatches.length, 1);
    assert.equal(report.mismatches[0]?.sku, "pump_1");
    assert.equal(report.mismatches[0]?.difference, "3");
  });

  it("skips products that have never had a StockItem row instead of treating them as zero stock", async () => {
    const db = new FakeDb();
    db.products.push({
      id: "p1",
      name: "Never counted product",
      unasSnapshot: {
        reportedStock: new Prisma.Decimal(5),
        reportedStockSyncedAt: new Date(),
      },
      variants: [{ id: "variant-1", sku: "never_counted" }],
    });
    // Deliberately no db.stockItems entry for variant-1: this product has
    // never been through a leltár or a POS/webshop sale, so no StockItem
    // row exists for it at all yet - it must not show up as a "mismatch".

    const repository = repositoryWith(db);
    const report = await repository.findStockDiscrepancies();

    assert.equal(report.checkedCount, 0);
    assert.equal(report.mismatches.length, 0);
  });
});
