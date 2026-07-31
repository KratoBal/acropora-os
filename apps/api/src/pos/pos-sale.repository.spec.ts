import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@acropora/database";

import {
  PosSaleRepository,
  type CreatePosSaleLine,
  type CreatePosSaleParams,
  type PosSaleDatabase,
} from "./pos-sale.repository.js";

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

/// Fake exercising PosSaleRepository.createSale() end to end, including the
/// shared postInventoryMovement() primitive - this repository no longer has
/// its own StockMovement/StockItem-writing or UNAS-calling code, see
/// pos-sale.repository.ts. As with the leltár/beszerzés fakes, this in-memory
/// double proves ordering and idempotency at the application level but not
/// genuine cross-statement Postgres rollback - that's covered at the shared
/// primitive level by inventory-movement-writer.spec.ts.
class FakeDb {
  warehouseId = "wh-1";
  orders: Array<{ id: string; orderNumber: string }> = [];
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

  salesOrder = {
    create: async (args: any) => {
      const id = nextId("order");
      this.orders.push({ id, orderNumber: args.data.orderNumber });
      return {
        id,
        orderNumber: args.data.orderNumber,
        status: args.data.status,
        paymentMethod: args.data.paymentMethod,
        customer: null,
        soldBy: null,
        currency: args.data.currency,
        totalNet: args.data.totalNet,
        totalTax: args.data.totalTax,
        totalGross: args.data.totalGross,
        createdAt: new Date(),
        completedAt: args.data.completedAt,
        lines: (args.data.lines?.create ?? []).map(
          (line: any, index: number) => ({
            id: `line-${index}`,
            variantId: line.variantId,
            sku: line.sku,
            productName: line.description,
            quantity: line.quantity,
            unit: line.unit,
            unitNet: line.unitNet,
            taxRate: line.taxRate,
            lineGross: line.lineGross,
            syncStatus: line.syncStatus,
            syncError: line.syncError,
          }),
        ),
      };
    },
    findMany: async () => [],
    findUnique: async () => null,
    count: async () => 0,
  };

  stockItem = {
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
    findMany: async () => [],
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
  return new PosSaleRepository(db as unknown as PosSaleDatabase);
}

function line(overrides: Partial<CreatePosSaleLine> = {}): CreatePosSaleLine {
  return {
    variantId: "variant-1",
    sku: "REEF-SALT-01",
    productName: "Reef Salt",
    unit: "db",
    quantity: new Prisma.Decimal("1"),
    taxRate: new Prisma.Decimal("27"),
    unitNet: new Prisma.Decimal("100"),
    lineGross: new Prisma.Decimal("127"),
    syncToUnas: true,
    stockComponents: [
      {
        variantId: "variant-1",
        sku: "REEF-SALT-01",
        productName: "Reef Salt",
        unit: "db",
        quantityPerSale: new Prisma.Decimal(1),
        syncToUnas: true,
      },
    ],
    ...overrides,
  };
}

function baseParams(
  overrides: Partial<CreatePosSaleParams> = {},
): CreatePosSaleParams {
  return {
    orderNumber: "POS-1",
    warehouseId: "wh-1",
    actorUserId: "user-1",
    paymentMethod: "CASH",
    customerId: null,
    lines: [line()],
    totals: {
      totalNet: new Prisma.Decimal("100"),
      totalTax: new Prisma.Decimal("27"),
      totalGross: new Prisma.Decimal("127"),
    },
    ...overrides,
  };
}

describe("PosSaleRepository.createSale", () => {
  it("creates the SalesOrder and books a SALE movement reducing stock, all in one call", async () => {
    const db = new FakeDb();
    db.stockItems.push({
      id: "stock-1",
      variantId: "variant-1",
      onHand: new Prisma.Decimal("10"),
    });
    const repository = repositoryWith(db);

    const result = await repository.createSale(
      baseParams({ lines: [line({ quantity: new Prisma.Decimal("3") })] }),
    );

    assert.equal(db.orders.length, 1);
    assert.equal(db.movements.length, 1);
    assert.equal(db.movementLines.length, 1);
    assert.equal(db.movementLines[0]?.quantity.toString(), "3");
    assert.equal(db.stockItems[0]?.onHand.toString(), "7");
    assert.equal(db.outbox.length, 1);
    assert.equal(db.outbox[0]?.targetOnHand.toString(), "7");
    assert.equal(result.stockWarnings.length, 0);
    assert.equal(result.detail.status, "COMPLETED");
  });

  it("books a package sale against component variants instead of the package variant", async () => {
    const db = new FakeDb();
    db.stockItems.push(
      {
        id: "stock-a",
        variantId: "component-a",
        onHand: new Prisma.Decimal("10"),
      },
      {
        id: "stock-b",
        variantId: "component-b",
        onHand: new Prisma.Decimal("5"),
      },
    );

    await repositoryWith(db).createSale(
      baseParams({
        lines: [
          line({
            variantId: "package-1",
            sku: "BUNDLE-1",
            quantity: new Prisma.Decimal("2"),
            stockComponents: [
              {
                variantId: "component-a",
                sku: "COMP-A",
                productName: "Komponens A",
                unit: "db",
                quantityPerSale: new Prisma.Decimal("2"),
                syncToUnas: true,
              },
              {
                variantId: "component-b",
                sku: "COMP-B",
                productName: "Komponens B",
                unit: "db",
                quantityPerSale: new Prisma.Decimal("0.5"),
                syncToUnas: true,
              },
            ],
          }),
        ],
      }),
    );

    assert.equal(
      db.stockItems
        .find((item) => item.variantId === "component-a")
        ?.onHand.toString(),
      "6",
    );
    assert.equal(
      db.stockItems
        .find((item) => item.variantId === "component-b")
        ?.onHand.toString(),
      "4",
    );
    assert.equal(
      db.stockItems.some((item) => item.variantId === "package-1"),
      false,
    );
    assert.deepEqual(db.outbox.map((row) => row.variantId).sort(), [
      "component-a",
      "component-b",
    ]);
  });

  it("allows the resulting stock to go negative and reports it as a stockWarning, without blocking or throwing", async () => {
    const db = new FakeDb();
    db.stockItems.push({
      id: "stock-1",
      variantId: "variant-1",
      onHand: new Prisma.Decimal("1"),
    });
    const repository = repositoryWith(db);

    const result = await repository.createSale(
      baseParams({ lines: [line({ quantity: new Prisma.Decimal("3") })] }),
    );

    assert.equal(db.stockItems[0]?.onHand.toString(), "-2");
    assert.equal(result.stockWarnings.length, 1);
    assert.equal(result.stockWarnings[0]?.resultingQty, "-2");
    assert.equal(result.stockWarnings[0]?.sku, "REEF-SALT-01");
    // The sale itself must still be completed - negative stock never blocks
    // a POS sale (see docs/INVENTORY-CONSISTENCY.md, "Negatív készlet").
    assert.equal(result.detail.status, "COMPLETED");
    assert.equal(db.orders.length, 1);
  });

  it("is idempotent for a repeated call with the same orderNumber - does not double-book stock or create a second movement", async () => {
    const db = new FakeDb();
    db.stockItems.push({
      id: "stock-1",
      variantId: "variant-1",
      onHand: new Prisma.Decimal("10"),
    });
    const repository = repositoryWith(db);
    const params = baseParams({
      lines: [line({ quantity: new Prisma.Decimal("3") })],
    });

    await repository.createSale(params);
    assert.equal(db.movements.length, 1);
    assert.equal(db.stockItems[0]?.onHand.toString(), "7");

    // Same orderNumber => same idempotencyKey (POS_SALE:<orderNumber>) - the
    // shared writer's own idempotency check must catch this even though the
    // repository doesn't do its own separate check (documented limitation:
    // this only protects the *same* orderNumber being processed twice, not a
    // genuine client double-submit that would generate a fresh orderNumber -
    // see buildIdempotencyKey's doc comment).
    await repository.createSale(params);
    assert.equal(db.movements.length, 1, "no second movement was created");
    assert.equal(
      db.stockItems[0]?.onHand.toString(),
      "7",
      "stock was not double-decremented",
    );
    assert.equal(db.outbox.length, 1, "no second outbox row was created");
  });

  it("aggregates two lines for the same physical variant without losing quantity", async () => {
    const db = new FakeDb();
    db.stockItems.push({
      id: "stock-1",
      variantId: "variant-1",
      onHand: new Prisma.Decimal("10"),
    });
    const repository = repositoryWith(db);

    await repository.createSale(
      baseParams({
        lines: [
          line({ quantity: new Prisma.Decimal("2") }),
          line({ quantity: new Prisma.Decimal("3") }),
        ],
      }),
    );

    assert.equal(db.movementLines.length, 1);
    assert.equal(db.stockItems[0]?.onHand.toString(), "5");
  });

  it("sets every created SalesOrderLine's syncStatus to PENDING, never a synchronous OK/FAILED", async () => {
    const db = new FakeDb();
    const repository = repositoryWith(db);

    const result = await repository.createSale(baseParams());

    for (const detailLine of result.detail.lines) {
      assert.equal(detailLine.syncStatus, "PENDING");
    }
  });
});
