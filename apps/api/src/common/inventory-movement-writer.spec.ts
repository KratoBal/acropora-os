import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@acropora/database";

import {
  buildOutboxIdempotencyKey,
  isDuplicateMovementIdempotencyKeyError,
  postInventoryMovement,
  type InventoryMovementDatabase,
} from "./inventory-movement-writer.js";

interface FakeStockMovement {
  id: string;
  idempotencyKey: string | null;
}

interface FakeStockItem {
  id: string;
  variantId: string;
  warehouseId: string;
  onHand: Prisma.Decimal;
}

interface FakeOutboxRow {
  id: string;
  variantId: string;
  warehouseId: string;
  status: string;
  idempotencyKey: string;
  targetOnHand: Prisma.Decimal;
  resolutionNote: string | null;
  sourceProcess: string;
  sourceRecordId: string;
}

/// Minimal in-memory double for InventoryMovementDatabase. Good enough to
/// exercise postInventoryMovement's own logic (idempotency, delta
/// application, outbox supersede-on-create) without a real Postgres - the
/// advisory lock itself is a no-op here (single-threaded test, nothing to
/// serialize against), which is fine: this suite is about *this
/// function's* bookkeeping, not about proving Postgres locking semantics.
function createFakeDatabase() {
  const movements: FakeStockMovement[] = [];
  const movementLines: unknown[] = [];
  const stockItems: FakeStockItem[] = [];
  const outbox: FakeOutboxRow[] = [];
  const lockedKeys: string[] = [];
  let idCounter = 0;
  const nextId = (prefix: string) => `${prefix}-${++idCounter}`;

  const database: InventoryMovementDatabase = {
    async $executeRaw(_strings, ...values) {
      lockedKeys.push(String(values[0]));
      return 1;
    },
    stockMovement: {
      async findFirst(args) {
        const where = (args as { where: { idempotencyKey: string } }).where;
        const found = movements.find(
          (m) => m.idempotencyKey === where.idempotencyKey,
        );
        return found ? { id: found.id } : null;
      },
      async create(args) {
        const data = (args as { data: { idempotencyKey: string | null } }).data;
        const row = {
          id: nextId("movement"),
          idempotencyKey: data.idempotencyKey,
        };
        movements.push(row);
        return { id: row.id };
      },
    },
    stockMovementLine: {
      async create(args) {
        movementLines.push(args);
        return {};
      },
    },
    stockItem: {
      async findFirst(args) {
        const where = (
          args as {
            where: { variantId: string; warehouseId: string };
          }
        ).where;
        const found = stockItems.find(
          (item) =>
            item.variantId === where.variantId &&
            item.warehouseId === where.warehouseId,
        );
        return found ? { id: found.id, onHand: found.onHand } : null;
      },
      async update(args) {
        const { where, data } = args as {
          where: { id: string };
          data: { onHand: Prisma.Decimal };
        };
        const found = stockItems.find((item) => item.id === where.id);
        if (!found) throw new Error("stock item not found");
        found.onHand = data.onHand;
        return {};
      },
      async create(args) {
        const data = (
          args as {
            data: {
              variantId: string;
              warehouseId: string;
              onHand: Prisma.Decimal;
            };
          }
        ).data;
        stockItems.push({
          id: nextId("stock-item"),
          variantId: data.variantId,
          warehouseId: data.warehouseId,
          onHand: data.onHand,
        });
        return {};
      },
    },
    unasStockSyncOutbox: {
      async updateMany(args) {
        const { where, data } = args as {
          where: {
            variantId: string;
            warehouseId: string;
            status: { in: string[] };
          };
          data: {
            status: string;
            resolutionNote: string;
            processedAt: Date;
          };
        };
        let count = 0;
        for (const row of outbox) {
          if (
            row.variantId === where.variantId &&
            row.warehouseId === where.warehouseId &&
            where.status.in.includes(row.status)
          ) {
            row.status = data.status;
            row.resolutionNote = data.resolutionNote;
            count += 1;
          }
        }
        return { count };
      },
      async create(args) {
        const data = (
          args as {
            data: {
              variantId: string;
              warehouseId: string;
              sku: string;
              targetOnHand: Prisma.Decimal;
              idempotencyKey: string;
              sourceProcess: string;
              sourceRecordId: string;
            };
          }
        ).data;
        const id = nextId("outbox");
        outbox.push({
          id,
          variantId: data.variantId,
          warehouseId: data.warehouseId,
          status: "PENDING",
          idempotencyKey: data.idempotencyKey,
          targetOnHand: data.targetOnHand,
          resolutionNote: null,
          sourceProcess: data.sourceProcess,
          sourceRecordId: data.sourceRecordId,
        });
        return { id };
      },
    },
  };

  return { database, movements, movementLines, stockItems, outbox, lockedKeys };
}

describe("postInventoryMovement", () => {
  it("creates a movement, applies the delta to a brand-new StockItem, and writes one outbox row", async () => {
    const fake = createFakeDatabase();

    const posted = await postInventoryMovement(fake.database, {
      idempotencyKey: "POS_SALE:ORDER-1",
      movementNumber: "ELAD-1",
      type: "SALE",
      warehouseId: "warehouse-1",
      referenceType: "SalesOrder",
      referenceId: "order-1",
      sourceProcess: "POS_SALE",
      lines: [
        {
          variantId: "variant-1",
          sku: "SKU-1",
          unit: "db",
          quantityDelta: new Prisma.Decimal(-2),
          syncToUnas: true,
        },
      ],
    });

    assert.equal(posted.alreadyPosted, false);
    assert.equal(posted.lines.length, 1);
    assert.equal(posted.lines[0]?.resultingOnHand.toString(), "-2");
    assert.equal(posted.lines[0]?.wentNegative, true);
    assert.equal(fake.stockItems.length, 1);
    assert.equal(fake.stockItems[0]?.onHand.toString(), "-2");
    assert.equal(fake.outbox.length, 1);
    assert.equal(fake.outbox[0]?.targetOnHand.toString(), "-2");
    assert.equal(
      fake.outbox[0]?.idempotencyKey,
      buildOutboxIdempotencyKey("POS_SALE:ORDER-1", "variant-1"),
    );
    assert.deepEqual(fake.lockedKeys, ["variant-1:warehouse-1"]);
  });

  it("applies a positive delta on top of an existing StockItem (purchase receipt style)", async () => {
    const fake = createFakeDatabase();
    fake.stockItems.push({
      id: "stock-item-existing",
      variantId: "variant-1",
      warehouseId: "warehouse-1",
      onHand: new Prisma.Decimal(5),
    });

    const posted = await postInventoryMovement(fake.database, {
      idempotencyKey: "PURCHASE_INVOICE:INV-1",
      movementNumber: "BESZ-1",
      type: "PURCHASE_RECEIPT",
      warehouseId: "warehouse-1",
      referenceType: "PurchaseInvoice",
      referenceId: "invoice-1",
      sourceProcess: "PURCHASE_INVOICE",
      lines: [
        {
          variantId: "variant-1",
          sku: "SKU-1",
          unit: "db",
          quantityDelta: new Prisma.Decimal(10),
          syncToUnas: true,
        },
      ],
    });

    assert.equal(posted.lines[0]?.resultingOnHand.toString(), "15");
    assert.equal(fake.stockItems[0]?.onHand.toString(), "15");
  });

  it("books local product stock without creating an UNAS outbox row", async () => {
    const fake = createFakeDatabase();

    const posted = await postInventoryMovement(fake.database, {
      idempotencyKey: "PURCHASE_INVOICE:LOCAL-1",
      movementNumber: "BESZ-LOCAL-1",
      type: "PURCHASE_RECEIPT",
      warehouseId: "warehouse-1",
      referenceType: "PurchaseInvoice",
      referenceId: "invoice-local-1",
      sourceProcess: "PURCHASE_INVOICE",
      lines: [
        {
          variantId: "variant-local-1",
          sku: "LOCAL-1",
          unit: "db",
          quantityDelta: new Prisma.Decimal(4),
          syncToUnas: false,
        },
      ],
    });

    assert.equal(posted.lines[0]?.resultingOnHand.toString(), "4");
    assert.equal(fake.stockItems[0]?.onHand.toString(), "4");
    assert.equal(fake.outbox.length, 0);
  });

  it("is idempotent: replaying the same idempotencyKey does not double-count", async () => {
    const fake = createFakeDatabase();

    const first = await postInventoryMovement(fake.database, {
      idempotencyKey: "POS_SALE:ORDER-2",
      movementNumber: "ELAD-2",
      type: "SALE",
      warehouseId: "warehouse-1",
      referenceType: "SalesOrder",
      referenceId: "order-2",
      sourceProcess: "POS_SALE",
      lines: [
        {
          variantId: "variant-2",
          sku: "SKU-2",
          unit: "db",
          quantityDelta: new Prisma.Decimal(-3),
          syncToUnas: true,
        },
      ],
    });
    assert.equal(first.alreadyPosted, false);

    const second = await postInventoryMovement(fake.database, {
      idempotencyKey: "POS_SALE:ORDER-2",
      movementNumber: "ELAD-2",
      type: "SALE",
      warehouseId: "warehouse-1",
      referenceType: "SalesOrder",
      referenceId: "order-2",
      sourceProcess: "POS_SALE",
      lines: [
        {
          variantId: "variant-2",
          sku: "SKU-2",
          unit: "db",
          quantityDelta: new Prisma.Decimal(-3),
          syncToUnas: true,
        },
      ],
    });

    assert.equal(second.alreadyPosted, true);
    assert.equal(second.lines.length, 0);
    // Only the first call's effects exist - stock was not decremented twice.
    assert.equal(fake.movements.length, 1);
    assert.equal(fake.stockItems.length, 1);
    assert.equal(fake.stockItems[0]?.onHand.toString(), "-3");
    assert.equal(fake.outbox.length, 1);
  });

  it("supersedes an older still-open outbox row for the same variant/warehouse instead of leaving two live rows", async () => {
    const fake = createFakeDatabase();

    await postInventoryMovement(fake.database, {
      idempotencyKey: "POS_SALE:ORDER-3",
      movementNumber: "ELAD-3",
      type: "SALE",
      warehouseId: "warehouse-1",
      referenceType: "SalesOrder",
      referenceId: "order-3",
      sourceProcess: "POS_SALE",
      lines: [
        {
          variantId: "variant-3",
          sku: "SKU-3",
          unit: "db",
          quantityDelta: new Prisma.Decimal(-1),
          syncToUnas: true,
        },
      ],
    });

    // Simulate the first row still being PENDING (worker hasn't drained it
    // yet) when a second, unrelated movement touches the same variant.
    assert.equal(fake.outbox[0]?.status, "PENDING");

    await postInventoryMovement(fake.database, {
      idempotencyKey: "POS_SALE:ORDER-4",
      movementNumber: "ELAD-4",
      type: "SALE",
      warehouseId: "warehouse-1",
      referenceType: "SalesOrder",
      referenceId: "order-4",
      sourceProcess: "POS_SALE",
      lines: [
        {
          variantId: "variant-3",
          sku: "SKU-3",
          unit: "db",
          quantityDelta: new Prisma.Decimal(-1),
          syncToUnas: true,
        },
      ],
    });

    assert.equal(fake.outbox.length, 2);
    assert.equal(fake.outbox[0]?.status, "SUCCEEDED");
    assert.match(fake.outbox[0]?.resolutionNote ?? "", /^superseded_by:/);
    assert.equal(fake.outbox[1]?.status, "PENDING");
    assert.equal(fake.outbox[1]?.targetOnHand.toString(), "-2");
  });

  it("throws when called with zero lines rather than silently posting an empty movement", async () => {
    const fake = createFakeDatabase();
    await assert.rejects(
      () =>
        postInventoryMovement(fake.database, {
          idempotencyKey: "POS_SALE:ORDER-5",
          movementNumber: "ELAD-5",
          type: "SALE",
          warehouseId: "warehouse-1",
          referenceType: "SalesOrder",
          referenceId: "order-5",
          sourceProcess: "POS_SALE",
          lines: [],
        }),
      /at least one line/,
    );
  });

  it("locks multi-variant lines in a deterministic (sorted by variantId) order regardless of input order, to avoid cross-transaction deadlocks", async () => {
    const fake = createFakeDatabase();

    await postInventoryMovement(fake.database, {
      idempotencyKey: "PURCHASE_INVOICE:INV-DEADLOCK-TEST",
      movementNumber: "BESZ-6",
      type: "PURCHASE_RECEIPT",
      warehouseId: "warehouse-1",
      referenceType: "PurchaseInvoice",
      referenceId: "invoice-6",
      sourceProcess: "PURCHASE_INVOICE",
      lines: [
        {
          variantId: "variant-z",
          sku: "SKU-Z",
          unit: "db",
          quantityDelta: new Prisma.Decimal(1),
          syncToUnas: true,
        },
        {
          variantId: "variant-a",
          sku: "SKU-A",
          unit: "db",
          quantityDelta: new Prisma.Decimal(1),
          syncToUnas: true,
        },
      ],
    });

    assert.deepEqual(fake.lockedKeys, [
      "variant-a:warehouse-1",
      "variant-z:warehouse-1",
    ]);
  });

  it("applies two lines for the same variant sequentially, in their original relative order, so the second builds on the first", async () => {
    const fake = createFakeDatabase();

    const posted = await postInventoryMovement(fake.database, {
      idempotencyKey: "PURCHASE_INVOICE:INV-MULTI-LINE",
      movementNumber: "BESZ-7",
      type: "PURCHASE_RECEIPT",
      warehouseId: "warehouse-1",
      referenceType: "PurchaseInvoice",
      referenceId: "invoice-7",
      sourceProcess: "PURCHASE_INVOICE",
      lines: [
        {
          variantId: "variant-1",
          sku: "SKU-1",
          unit: "db",
          quantityDelta: new Prisma.Decimal(5),
          syncToUnas: true,
        },
        {
          variantId: "variant-1",
          sku: "SKU-1",
          unit: "db",
          quantityDelta: new Prisma.Decimal(3),
          syncToUnas: true,
        },
      ],
    });

    assert.equal(posted.lines[0]?.resultingOnHand.toString(), "5");
    assert.equal(posted.lines[1]?.resultingOnHand.toString(), "8");
    assert.equal(fake.stockItems[0]?.onHand.toString(), "8");
  });
});

describe("isDuplicateMovementIdempotencyKeyError", () => {
  it("recognizes a P2002 violation on the idempotencyKey unique index", async () => {
    const { Prisma: RuntimePrisma } = await import("@acropora/database");
    const error = new RuntimePrisma.PrismaClientKnownRequestError("duplicate", {
      code: "P2002",
      clientVersion: "test",
      meta: { target: ["idempotencyKey"] },
    });
    assert.equal(isDuplicateMovementIdempotencyKeyError(error), true);
  });

  it("does not misclassify a P2002 on a different unique field", async () => {
    const { Prisma: RuntimePrisma } = await import("@acropora/database");
    const error = new RuntimePrisma.PrismaClientKnownRequestError("duplicate", {
      code: "P2002",
      clientVersion: "test",
      meta: { target: ["documentNumber"] },
    });
    assert.equal(isDuplicateMovementIdempotencyKeyError(error), false);
  });

  it("returns false for an unrelated error", () => {
    assert.equal(
      isDuplicateMovementIdempotencyKeyError(new Error("boom")),
      false,
    );
  });
});
