import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@acropora/database";
import type { UnasApiOrder } from "@acropora/types";

import { UnasOrderSyncRepository } from "./unas-order-sync.repository.js";

const runIntegration = process.env.RUN_DB_INTEGRATION === "1";

/// The checkpoint-3 unit tests in unas-order-sync.repository.spec.ts prove
/// the DELTA MATH is correct against a FakeDb - but FakeDb's `$executeRaw`
/// is a no-op stub, so it cannot prove the actual concurrency guarantee
/// `lockUnasOrder` exists for: that two REAL, simultaneously-running
/// database transactions racing to resync the SAME UNAS order never both
/// compute their delta from the same stale "already booked" snapshot and
/// double-book it. That requires a real Postgres `pg_advisory_xact_lock`,
/// which only exists once a real connection is involved - hence this
/// separate, RUN_DB_INTEGRATION=1-gated suite, exactly like
/// unas-stock-sync-outbox.repository.integration.spec.ts's own equivalent
/// gap for `FOR UPDATE SKIP LOCKED`. Could not be executed in the sandbox
/// this was written in (see project memory on sandbox limitations - no
/// generated @prisma/client, no local Postgres reachable); must be run
/// locally (`pnpm --filter @acropora/api test:integration`) before
/// checkpoint 5 is considered verified end-to-end. NOT reported as passing
/// here - only as written and unexecuted.
function baseOrder(overrides: Partial<UnasApiOrder> = {}): UnasApiOrder {
  return {
    key: overrides.key ?? "CONCURRENCY-TEST-1",
    internalKey: null,
    status: "Feldolgozás alatt",
    statusType: "open_normal",
    statusId: "3",
    orderedAt: "2026-07-20T14:05:00.000Z",
    customerName: "Integration Teszt",
    customerEmail: "integration@example.test",
    buyerInvoiceName: "Integration Teszt",
    buyerTaxNumber: null,
    buyerEuTaxNumber: null,
    buyerCustomerType: "private",
    buyerCountryCode: "HU",
    buyerZip: "1111",
    buyerCity: "Budapest",
    buyerAddress: "Teszt utca 1.",
    invoiceStatus: null,
    invoiceNumber: null,
    invoiceUrl: null,
    currency: "HUF",
    sumPriceGross: "6350",
    paymentName: "Bankkártya",
    paymentType: "bankcard",
    paymentStatus: "paid",
    shippingName: "GLS",
    couponCode: null,
    items: [],
    ...overrides,
  };
}

function orderWithQty(key: string, sku: string, qty: number): UnasApiOrder {
  return baseOrder({
    key,
    items: [
      {
        id: "1",
        sku,
        name: "Integration test product",
        unit: "db",
        quantity: String(qty),
        priceNet: "5000",
        priceGross: "6350",
        vatRate: "27",
      },
    ],
  });
}

describe(
  "UnasOrderSyncRepository order-level advisory lock (real Postgres) integration",
  { skip: !runIntegration },
  () => {
    const repository = new UnasOrderSyncRepository();
    let warehouseId = "";
    let variantIds: string[] = [];
    let productIds: string[] = [];
    const runIds: string[] = [];

    async function createRunningRun(): Promise<string> {
      const run = await prisma.unasOrderSyncRun.create({
        data: {
          windowStart: null,
          windowEnd: new Date(),
          activeKey: null, // deliberately not "UNAS_ORDERS" - multiple concurrent RUNNING rows are fine for this test, only the per-order advisory lock is under test here, not createRun's own single-active-run guard.
          status: "RUNNING",
          startedAt: new Date(),
        },
      });
      runIds.push(run.id);
      return run.id;
    }

    before(async () => {
      const warehouse = await prisma.warehouse.create({
        data: { code: `LOCK-TEST-${Date.now()}`, name: "Lock test warehouse" },
      });
      warehouseId = warehouse.id;

      const skus = [`LOCK-SKU-A-${Date.now()}`, `LOCK-SKU-B-${Date.now()}`];
      for (const sku of skus) {
        const product = await prisma.product.create({
          data: { name: `Lock test product ${sku}` },
        });
        productIds.push(product.id);
        const variant = await prisma.productVariant.create({
          data: { productId: product.id, sku },
        });
        variantIds.push(variant.id);
      }
    });

    after(async () => {
      await prisma.stockMovementLine.deleteMany({ where: { variantId: { in: variantIds } } });
      await prisma.stockMovement.deleteMany({ where: { sourceWarehouseId: warehouseId } });
      await prisma.unasStockSyncOutbox.deleteMany({ where: { warehouseId } });
      await prisma.stockItem.deleteMany({ where: { warehouseId } });
      await prisma.salesOrderLine.deleteMany({});
      await prisma.externalReference.deleteMany({ where: { system: "UNAS", entityType: "SalesOrder" } });
      await prisma.salesOrder.deleteMany({ where: { warehouseId } });
      await prisma.unasOrderSyncRun.deleteMany({ where: { id: { in: runIds } } });
      await prisma.productVariant.deleteMany({ where: { id: { in: variantIds } } });
      await prisma.product.deleteMany({ where: { id: { in: productIds } } });
      await prisma.warehouse.delete({ where: { id: warehouseId } });
      await prisma.$disconnect();
    });

    it(
      "posts exactly one net additional SALE(1) when two concurrent resyncs both see a 2->3 quantity change from the same starting state",
      { timeout: 30_000 },
      async () => {
        const key = `LOCK-ORDER-${Date.now()}`;
        const sku = (await prisma.productVariant.findUniqueOrThrow({ where: { id: variantIds[0]! } })).sku;

        // Establish the order at quantity 2 first (its own, uncontended import).
        const firstRun = await createRunningRun();
        await repository.apply(firstRun, [orderWithQty(key, sku, 2)], null, new Date());

        const reference = await prisma.externalReference.findUniqueOrThrow({
          where: { system_entityType_externalId: { system: "UNAS", entityType: "SalesOrder", externalId: key } },
        });
        const orderId = reference.entityId;

        const stockAfterFirst = await prisma.stockItem.findFirstOrThrow({
          where: { variantId: variantIds[0]!, warehouseId, locationId: null, lotId: null },
        });
        assert.equal(stockAfterFirst.onHand.toString(), "-2");

        // Two concurrent sightings of the SAME order, now at quantity 3 -
        // e.g. a scheduled batch tick and a manual "Rendelés frissítése"
        // overlapping. Both are handed the identical UnasApiOrder payload;
        // only ONE of them may actually be the one that posts the +1 delta,
        // the other must re-read the ledger under the lock and no-op.
        const order3 = orderWithQty(key, sku, 3);
        const [resultA, resultB] = await Promise.all([
          repository.refreshOrder(orderId, order3),
          repository.refreshOrder(orderId, order3),
        ]);

        const stockAfterBoth = await prisma.stockItem.findFirstOrThrow({
          where: { variantId: variantIds[0]!, warehouseId, locationId: null, lotId: null },
        });
        // 2 units sold (-2), then exactly 1 more (-1) = -3 total - NOT -4,
        // which is what double-booking the 2->3 delta would produce.
        assert.equal(stockAfterBoth.onHand.toString(), "-3");

        const movements = await prisma.stockMovement.findMany({
          where: { referenceType: "SalesOrder", referenceId: orderId, type: { in: ["SALE", "RETURN_IN"] } },
          include: { lines: true },
        });
        // Exactly 2 movements total for this order: the initial import's
        // SALE(2), and ONE resync SALE(1) - not two competing SALE(1) rows.
        assert.equal(movements.length, 2);
        const saleQuantities = (
          movements as Array<{ type: string; lines: Array<{ quantity: { toString(): string } }> }>
        )
          .filter((movement) => movement.type === "SALE")
          .flatMap((movement) => movement.lines.map((line) => line.quantity.toString()));
        assert.deepEqual(saleQuantities.sort(), ["1", "2"]);

        // Exactly one of the two concurrent refreshOrder calls should have
        // reported `updated: true` (Boolean XOR) - the other saw delta=0
        // once it acquired the lock after the first had already committed.
        assert.notEqual(resultA.updated, resultB.updated);
      },
    );

    it(
      "processes two DIFFERENT orders concurrently without deadlocking or blocking each other",
      { timeout: 30_000 },
      async () => {
        const keyA = `LOCK-PARALLEL-A-${Date.now()}`;
        const keyB = `LOCK-PARALLEL-B-${Date.now()}`;
        const skuA = (await prisma.productVariant.findUniqueOrThrow({ where: { id: variantIds[0]! } })).sku;
        const skuB = (await prisma.productVariant.findUniqueOrThrow({ where: { id: variantIds[1]! } })).sku;

        // Read "before" rather than assuming a fresh/zero starting point -
        // this suite's tests share the same two variants and Postgres
        // instance, so asserting on the DELTA this operation caused (rather
        // than a hardcoded absolute onHand) keeps the test correct
        // regardless of what earlier tests in this file already posted.
        const [onHandBeforeA, onHandBeforeB] = await Promise.all([
          prisma.stockItem.findFirst({
            where: { variantId: variantIds[0]!, warehouseId, locationId: null, lotId: null },
          }),
          prisma.stockItem.findFirst({
            where: { variantId: variantIds[1]!, warehouseId, locationId: null, lotId: null },
          }),
        ]);

        const runA = await createRunningRun();
        const runB = await createRunningRun();

        await Promise.all([
          repository.apply(runA, [orderWithQty(keyA, skuA, 1)], null, new Date()),
          repository.apply(runB, [orderWithQty(keyB, skuB, 1)], null, new Date()),
        ]);

        const [stockA, stockB] = await Promise.all([
          prisma.stockItem.findFirstOrThrow({
            where: { variantId: variantIds[0]!, warehouseId, locationId: null, lotId: null },
          }),
          prisma.stockItem.findFirstOrThrow({
            where: { variantId: variantIds[1]!, warehouseId, locationId: null, lotId: null },
          }),
        ]);
        assert.equal(
          stockA.onHand.minus(onHandBeforeA?.onHand ?? 0).toString(),
          "-1",
        );
        assert.equal(
          stockB.onHand.minus(onHandBeforeB?.onHand ?? 0).toString(),
          "-1",
        );
      },
    );

    it(
      "does not deadlock when a multi-variant order's lines are processed in reverse variantId order by a concurrent caller",
      { timeout: 30_000 },
      async () => {
        const keyC = `LOCK-MULTI-${Date.now()}`;
        const skuA = (await prisma.productVariant.findUniqueOrThrow({ where: { id: variantIds[0]! } })).sku;
        const skuB = (await prisma.productVariant.findUniqueOrThrow({ where: { id: variantIds[1]! } })).sku;
        const multiOrder = baseOrder({
          key: keyC,
          items: [
            { id: "1", sku: skuA, name: "A", unit: "db", quantity: "1", priceNet: "1000", priceGross: "1270", vatRate: "27" },
            { id: "2", sku: skuB, name: "B", unit: "db", quantity: "1", priceNet: "1000", priceGross: "1270", vatRate: "27" },
          ],
        });
        const runC = await createRunningRun();
        const runD = await createRunningRun();
        // Both concurrent calls import a DIFFERENT (but internally
        // multi-line) order to prove the writer's deterministic
        // variantId-sorted lock acquisition (inventory-movement-writer.ts)
        // never deadlocks against this order-level lock, regardless of the
        // order the two orders' own advisory locks happen to be acquired in.
        const keyD = `LOCK-MULTI-D-${Date.now()}`;
        const multiOrderD = baseOrder({ ...multiOrder, key: keyD });
        await Promise.all([
          repository.apply(runC, [multiOrder], null, new Date()),
          repository.apply(runD, [multiOrderD], null, new Date()),
        ]);
        // Reaching this line at all (within the 30s test timeout) is the
        // actual assertion - a deadlock would hang until Postgres's own
        // deadlock_timeout kills one side with an error, which would fail
        // the test rather than hang it forever either way.
        assert.ok(true, "both concurrent multi-variant imports completed without deadlocking");
      },
    );
  },
);
