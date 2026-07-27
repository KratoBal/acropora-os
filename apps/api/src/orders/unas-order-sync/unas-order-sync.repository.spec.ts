import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@acropora/database";
import type { UnasApiOrder } from "@acropora/types";

import {
  UnasOrderSyncRepository,
  type UnasOrderSyncDatabase,
} from "./unas-order-sync.repository.js";
import type { SalesOrderWithRelations } from "./unas-order-sync.types.js";

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
  unasInvoiceStatus: string | null;
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
    metadata: Record<string, unknown> | null;
  }> = [];
  movements: FakeMovement[] = [];
  invoices: Array<{
    id: string;
    source: string;
    invoiceNumber: string;
    salesOrderId: string | null;
    partnerName: string;
    partnerTaxNumber: string | null;
    currency: string;
    externalUrl: string | null;
    syncStatus: string;
  }> = [];
  runs: Array<Record<string, unknown>> = [];
  cursor: Date | null = null;
  // Counts salesOrderLine.create/update calls - a direct, unambiguous
  // signal of whether syncLines() (the active-order line-resync path) ran,
  // independent of the generic updatedCount summary field (which also
  // legitimately increments for the narrow, CANCELLED-order
  // unasInvoiceStatus-only refresh - see the CANCELLED->CANCELLED tests).
  lineWriteCount = 0;
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
      if (args.where.system_entityType_externalId) {
        const key = args.where.system_entityType_externalId;
        const found = this.externalReferences.find(
          (reference) => reference.externalId === key.externalId,
        );
        return found ? { id: found.id, entityId: found.entityId } : null;
      }
      const key = args.where.system_entityType_entityId;
      const found = this.externalReferences.find(
        (reference) => reference.entityId === key.entityId,
      );
      return found ? { metadata: found.metadata } : null;
    },
    findMany: async (args: any) => {
      const ids: string[] = args.where.entityId.in;
      return this.externalReferences
        .filter((reference) => ids.includes(reference.entityId))
        .map((reference) => ({
          entityId: reference.entityId,
          metadata: reference.metadata,
        }));
    },
    create: async (args: any) => {
      const row = {
        id: nextId("ref"),
        entityId: args.data.entityId as string,
        externalId: args.data.externalId as string,
        metadata: (args.data.metadata as Record<string, unknown>) ?? null,
      };
      this.externalReferences.push(row);
      return row;
    },
    update: async (args: any) => {
      const row = this.externalReferences.find(
        (reference) => reference.id === args.where.id,
      );
      if (row && args.data.metadata !== undefined)
        row.metadata = args.data.metadata as Record<string, unknown>;
      return row ?? {};
    },
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
        // Real createNewOrder() always passes this explicitly (see
        // repository.ts), but default to null (Prisma's own default for
        // an omitted nullable field) so this fake doesn't silently diverge
        // from real Prisma behavior if a future caller ever omits it.
        unasInvoiceStatus:
          (args.data.unasInvoiceStatus as string | null | undefined) ?? null,
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
        // Must mirror the real select in apply() (unasInvoiceStatus: true)
        // - omitting this previously made existing.unasInvoiceStatus
        // always `undefined` here even when the real column held `null`,
        // which spuriously made `order.invoiceStatus !== existing.
        // unasInvoiceStatus` (repository.ts) evaluate true on every
        // CANCELLED->CANCELLED resync regardless of any real change.
        unasInvoiceStatus: order.unasInvoiceStatus,
        lines: order.lines.map((line) => ({
          id: line.id,
          sku: line.sku,
          variantId: line.variantId,
          quantity: line.quantity,
          syncStatus: line.syncStatus,
        })),
      };
    },
    findMany: async () => [],
    count: async () => this.orders.length,
  };

  salesOrderLine = {
    create: async (args: any) => {
      this.lineWriteCount += 1;
      const order = this.orders.find((o) => o.id === args.data.orderId);
      const line: FakeOrderLine = {
        id: nextId("line"),
        variantId: args.data.variantId,
        sku: args.data.sku,
        quantity: args.data.quantity,
        syncStatus: args.data.syncStatus,
        syncError: args.data.syncError,
      };
      order?.lines.push(line);
      return line;
    },
    update: async (args: any) => {
      this.lineWriteCount += 1;
      for (const order of this.orders) {
        const line = order.lines.find((l) => l.id === args.where.id);
        if (line) {
          Object.assign(line, args.data);
          return line;
        }
      }
      return {};
    },
  };

  invoice = {
    findUnique: async (args: any) => {
      const key = args.where.source_invoiceNumber;
      const found = this.invoices.find(
        (invoice) =>
          invoice.source === key.source &&
          invoice.invoiceNumber === key.invoiceNumber,
      );
      return found
        ? { id: found.id, salesOrderId: found.salesOrderId }
        : null;
    },
    create: async (args: any) => {
      const row = {
        id: nextId("invoice"),
        source: args.data.source as string,
        invoiceNumber: args.data.invoiceNumber as string,
        salesOrderId: (args.data.salesOrderId as string) ?? null,
        partnerName: args.data.partnerName as string,
        partnerTaxNumber: (args.data.partnerTaxNumber as string) ?? null,
        currency: args.data.currency as string,
        externalUrl: (args.data.externalUrl as string) ?? null,
        syncStatus: args.data.syncStatus as string,
      };
      this.invoices.push(row);
      return row;
    },
    update: async (args: any) => {
      const row = this.invoices.find((invoice) => invoice.id === args.where.id);
      if (row) Object.assign(row, args.data);
      return row ?? {};
    },
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
    buyerInvoiceName: "Kovács Anna",
    buyerTaxNumber: null,
    buyerEuTaxNumber: null,
    buyerCustomerType: "private",
    buyerCountryCode: "HU",
    buyerZip: "2030",
    buyerCity: "Érd",
    buyerAddress: "Tárnoki út 23.",
    invoiceStatus: null,
    invoiceNumber: null,
    invoiceUrl: null,
    currency: "HUF",
    sumPriceGross: "12700",
    paymentName: "Bankkártya",
    paymentType: "bankcard",
    paymentStatus: "paid",
    shippingName: "GLS",
    couponCode: null,
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
    const movementCountAfterCancel = db.movements.length;
    const lineSnapshotAfterCancel = db.orders[0]!.lines.map((line) => ({
      ...line,
    }));
    const summaryAgain = await repository.apply(
      "run-3",
      [cancelled],
      null,
      new Date(),
    );
    assert.equal(summaryAgain.reversedCount, 0);
    assert.equal(db.stockItems[0]?.onHand.toString(), "10");
    // No third StockMovement (SALE + RETURN_IN only) on the repeated
    // CANCELLED->CANCELLED sighting.
    assert.equal(db.movements.length, movementCountAfterCancel);
    // Status must stay CANCELLED, never perturbed by the repeated sighting.
    assert.equal(db.orders[0]?.status, "CANCELLED");
    // Line items must be untouched - the CANCELLED->CANCELLED branch must
    // not fall into the live-order syncLines()/full-update path.
    assert.deepEqual(db.orders[0]!.lines, lineSnapshotAfterCancel);
  });

  it("CANCELLED->CANCELLED resync does not run the active-order line/total resync path", async () => {
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
    const cancelled = baseOrder({ statusType: "close_fault", status: "Sztornó" });
    await repository.apply("run-2", [cancelled], null, new Date());
    const linesBefore = db.orders[0]!.lines.length;
    const movementCountBefore = db.movements.length;
    const stockBefore = db.stockItems[0]!.onHand.toString();

    // A subsequent CANCELLED sighting that also carries a changed price on
    // an existing line and no invoice-status change: if the live-order
    // branch (syncLines + totals update) were mistakenly still reachable,
    // this price change would show up locally. It must not. Since
    // invoiceStatus stays null across all three runs (never overridden by
    // baseOrder()), and FakeDb.salesOrder.findUnique now correctly
    // projects the previously-persisted unasInvoiceStatus (see the
    // salesOrder fake above), invoiceStatusChanged correctly evaluates to
    // false here too - just as it would against a real Prisma database -
    // so the CANCELLED->CANCELLED branch's own targeted unasInvoiceStatus
    // refresh must not fire either, and summary.updatedCount stays 0.
    db.runs.push({ id: "run-3", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    const cancelledWithPriceEdit = baseOrder({
      statusType: "close_fault",
      status: "Sztornó",
      items: [
        {
          id: "1",
          sku: "pump_1",
          name: "Reef Pump (edited)",
          unit: "db",
          quantity: "2",
          priceNet: "9999",
          priceGross: "12698.73",
          vatRate: "27",
        },
      ],
    });
    const lineWriteCountBefore = db.lineWriteCount;
    const totalsBefore = (db.orders[0] as unknown as Record<string, unknown>)
      .totalGross;
    const summary = await repository.apply(
      "run-3",
      [cancelledWithPriceEdit],
      null,
      new Date(),
    );

    // No targeted unasInvoiceStatus update fired either, since nothing
    // about the UNAS-side invoice status actually changed between run-2
    // and run-3 - this is the real, meaningful signal (not just an
    // absence-of-syncLines proxy).
    assert.equal(summary.updatedCount, 0);
    // syncLines() (the active-order line resync) never ran.
    assert.equal(
      db.lineWriteCount,
      lineWriteCountBefore,
      "syncLines() must not call salesOrderLine.create/update for a CANCELLED->CANCELLED resync",
    );
    assert.equal(db.orders[0]!.lines.length, linesBefore);
    assert.equal(db.orders[0]!.lines[0]?.sku, "pump_1");
    // unitNet/description aren't tracked on FakeOrderLine, so absence of a
    // new/replaced line row (and the lineWriteCount check above) is proof
    // that syncLines() never ran.
    // totalGross is only ever written by the live-order branch's
    // salesOrder.update (Object.assign onto the untyped fake row) - it
    // must stay whatever it was before this run (undefined, since neither
    // createNewOrder nor the CANCELLED branches ever set it in this fake).
    assert.equal(
      (db.orders[0] as unknown as Record<string, unknown>).totalGross,
      totalsBefore,
    );
    // No new StockMovement (reverseOrder() must not run again - it already
    // ran exactly once on the ACTIVE->CANCELLED transition in run-2).
    assert.equal(db.movements.length, movementCountBefore);
    assert.equal(db.stockItems[0]!.onHand.toString(), stockBefore);
    assert.equal(
      db.movements.filter((movement) => movement.type === "RETURN_IN")
        .length,
      1,
      "reverseOrder() must have run exactly once in total, not again on this resync",
    );
    assert.equal(db.orders[0]?.status, "CANCELLED");
  });

  it("CANCELLED->CANCELLED resync still lets the read-only invoice mirror pick up a genuine UNAS invoice-status change", async () => {
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
    const cancelled = baseOrder({ statusType: "close_fault", status: "Sztornó" });
    await repository.apply("run-2", [cancelled], null, new Date());
    assert.equal(db.invoices.length, 0);

    // UNAS/Számlázz.hu can still bill (or storno) an order that's already
    // CANCELLED locally. This is a genuine invoiceStatus change
    // (null -> BILLED), so the targeted unasInvoiceStatus refresh in the
    // CANCELLED->CANCELLED branch SHOULD fire this time (updatedCount=1
    // is correct here, unlike the previous test) - and the read-only
    // invoice mirror must pick up the invoice regardless, since
    // syncInvoiceMirror() runs unconditionally after the branch.
    db.runs.push({ id: "run-3", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    const cancelledAndBilled = baseOrder({
      statusType: "close_fault",
      status: "Sztornó",
      invoiceStatus: "BILLED",
      invoiceNumber: "SZ-2026-CANCEL-2",
    });
    const summary = await repository.apply(
      "run-3",
      [cancelledAndBilled],
      null,
      new Date(),
    );

    assert.equal(summary.updatedCount, 1);
    assert.equal(db.invoices.length, 1);
    assert.equal(db.invoices[0]?.invoiceNumber, "SZ-2026-CANCEL-2");
    assert.equal(db.invoices[0]?.salesOrderId, db.orders[0]?.id);
    assert.equal(db.orders[0]?.status, "CANCELLED");
  });

  it("still mirrors a UNAS invoice onto a CANCELLED order (invoice mirror is unconditional)", async () => {
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
    const cancelled = baseOrder({ statusType: "close_fault", status: "Sztornó" });
    await repository.apply("run-2", [cancelled], null, new Date());
    assert.equal(db.invoices.length, 0);

    // UNAS/Számlázz.hu can still issue a real invoice/storno document for
    // an order that's already CANCELLED locally - the read-only mirror
    // must still pick it up deterministically, unaffected by the
    // CANCELLED->CANCELLED branch above it.
    db.runs.push({ id: "run-3", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    const cancelledAndBilled = baseOrder({
      statusType: "close_fault",
      status: "Sztornó",
      invoiceStatus: "BILLED",
      invoiceNumber: "SZ-2026-CANCEL-1",
    });
    await repository.apply("run-3", [cancelledAndBilled], null, new Date());

    assert.equal(db.invoices.length, 1);
    assert.equal(db.invoices[0]?.invoiceNumber, "SZ-2026-CANCEL-1");
    assert.equal(db.invoices[0]?.salesOrderId, db.orders[0]?.id);
    assert.equal(db.orders[0]?.status, "CANCELLED");
  });
});

describe("UnasOrderSyncRepository.apply - read-only UNAS invoice mirror", () => {
  function runningDb(): FakeDb {
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
    return db;
  }

  it("does not create an Invoice row when the UNAS order has no invoice data", async () => {
    const db = runningDb();
    db.runs.push({ id: "run-1", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    const repository = repositoryWith(db);

    await repository.apply("run-1", [baseOrder()], null, new Date());

    assert.equal(db.invoices.length, 0);
  });

  it("does not create an Invoice row for a known-but-unbillable or billable-not-yet-billed status", async () => {
    const db = runningDb();
    db.runs.push({ id: "run-1", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    const repository = repositoryWith(db);

    await repository.apply(
      "run-1",
      [baseOrder({ invoiceStatus: "BILLABLE" })],
      null,
      new Date(),
    );

    assert.equal(db.invoices.length, 0);
  });

  it("does not fabricate an Invoice row when BILLED but the invoice number or buyer name is missing", async () => {
    const db = runningDb();
    db.runs.push({ id: "run-1", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    const repository = repositoryWith(db);

    await repository.apply(
      "run-1",
      [
        baseOrder({
          invoiceStatus: "BILLED",
          invoiceNumber: null,
        }),
      ],
      null,
      new Date(),
    );

    assert.equal(db.invoices.length, 0);
  });

  it("mirrors an already-billed order on first sighting (create path)", async () => {
    const db = runningDb();
    db.runs.push({ id: "run-1", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    const repository = repositoryWith(db);

    await repository.apply(
      "run-1",
      [
        baseOrder({
          invoiceStatus: "BILLED",
          invoiceNumber: "SZ-2026-001",
          invoiceUrl: "https://www.szamlazz.hu/szamla/pdf/SZ-2026-001",
        }),
      ],
      null,
      new Date(),
    );

    assert.equal(db.invoices.length, 1);
    assert.equal(db.invoices[0]?.source, "UNAS");
    assert.equal(db.invoices[0]?.invoiceNumber, "SZ-2026-001");
    assert.equal(db.invoices[0]?.salesOrderId, db.orders[0]?.id);
    assert.equal(
      db.invoices[0]?.externalUrl,
      "https://www.szamlazz.hu/szamla/pdf/SZ-2026-001",
    );
  });

  it("only saves an externalUrl when UNAS genuinely provides one", async () => {
    const db = runningDb();
    db.runs.push({ id: "run-1", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    const repository = repositoryWith(db);

    await repository.apply(
      "run-1",
      [
        baseOrder({
          invoiceStatus: "BILLED",
          invoiceNumber: "SZ-2026-002",
          invoiceUrl: null,
        }),
      ],
      null,
      new Date(),
    );

    assert.equal(db.invoices[0]?.externalUrl, null);
  });

  it("mirrors an order that becomes billed on a later sighting (update path) and persists the UNAS invoice status", async () => {
    const db = runningDb();
    db.runs.push({ id: "run-1", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    const repository = repositoryWith(db);
    await repository.apply(
      "run-1",
      [baseOrder({ invoiceStatus: "BILLABLE" })],
      null,
      new Date(),
    );
    assert.equal(db.invoices.length, 0);

    db.runs.push({ id: "run-2", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    await repository.apply(
      "run-2",
      [
        baseOrder({
          invoiceStatus: "BILLED",
          invoiceNumber: "SZ-2026-003",
        }),
      ],
      null,
      new Date(),
    );

    assert.equal(db.invoices.length, 1);
    assert.equal(db.invoices[0]?.invoiceNumber, "SZ-2026-003");
  });

  it("does not duplicate the Invoice row on repeated sync of the same billed order", async () => {
    const db = runningDb();
    db.runs.push({ id: "run-1", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    const repository = repositoryWith(db);
    const billed = baseOrder({
      invoiceStatus: "BILLED",
      invoiceNumber: "SZ-2026-004",
    });
    await repository.apply("run-1", [billed], null, new Date());

    db.runs.push({ id: "run-2", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    await repository.apply("run-2", [billed], null, new Date());
    db.runs.push({ id: "run-3", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    await repository.apply("run-3", [billed], null, new Date());

    assert.equal(db.invoices.length, 1);
  });

  it("controllably updates the local mirror when UNAS invoice data changes", async () => {
    const db = runningDb();
    db.runs.push({ id: "run-1", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    const repository = repositoryWith(db);
    await repository.apply(
      "run-1",
      [
        baseOrder({
          invoiceStatus: "BILLED",
          invoiceNumber: "SZ-2026-005",
          invoiceUrl: null,
        }),
      ],
      null,
      new Date(),
    );
    assert.equal(db.invoices[0]?.externalUrl, null);

    db.runs.push({ id: "run-2", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    await repository.apply(
      "run-2",
      [
        baseOrder({
          invoiceStatus: "BILLED",
          invoiceNumber: "SZ-2026-005",
          invoiceUrl: "https://www.szamlazz.hu/szamla/pdf/SZ-2026-005",
        }),
      ],
      null,
      new Date(),
    );

    assert.equal(db.invoices.length, 1);
    assert.equal(
      db.invoices[0]?.externalUrl,
      "https://www.szamlazz.hu/szamla/pdf/SZ-2026-005",
    );
  });

  it("never merges two different local orders onto the same mirrored invoice number", async () => {
    const db = runningDb();
    db.variants.push({ id: "variant-2", sku: "pump_2" });
    db.stockItems.push({
      id: "stock-2",
      variantId: "variant-2",
      warehouseId: "wh-1",
      onHand: new Prisma.Decimal(10),
    });
    db.runs.push({ id: "run-1", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    const repository = repositoryWith(db);

    await repository.apply(
      "run-1",
      [
        baseOrder({
          key: "UN-1",
          invoiceStatus: "BILLED",
          invoiceNumber: "SZ-2026-006",
        }),
      ],
      null,
      new Date(),
    );
    assert.equal(db.invoices.length, 1);
    const firstOrderId = db.invoices[0]?.salesOrderId;

    db.runs.push({ id: "run-2", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    await repository.apply(
      "run-2",
      [
        baseOrder({
          key: "UN-2",
          invoiceStatus: "BILLED",
          invoiceNumber: "SZ-2026-006",
          items: [
            {
              id: "1",
              sku: "pump_2",
              name: "Reef Pump 2",
              unit: "db",
              quantity: "1",
              priceNet: "5000",
              priceGross: "6350",
              vatRate: "27",
            },
          ],
        }),
      ],
      null,
      new Date(),
    );

    // Still exactly one Invoice row, still pointing at the first order -
    // the conflicting second order's sighting must not reassign it.
    assert.equal(db.invoices.length, 1);
    assert.equal(db.invoices[0]?.salesOrderId, firstOrderId);
    assert.equal(db.orders.length, 2);
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

// A small, purpose-built fake instead of extending the big FakeDb above:
// FakeDb's salesOrder.findUnique returns the narrow { id, status,
// unasInvoiceStatus, lines } shape apply() selects internally (see its
// own comment re: mirroring the real select), not the wider detail shape
// findById() needs (orderNumber, buyerName, totals, invoices, ...) - and
// this task deliberately doesn't touch anything apply()-related, so it
// doesn't widen a fake that dozens of existing apply() tests depend on.
describe("UnasOrderSyncRepository.findById", () => {
  function repositoryWithOrder(
    order: SalesOrderWithRelations | null,
    referenceMetadata: Record<string, unknown> | null = null,
  ) {
    const fakeDatabase = {
      salesOrder: { findUnique: async () => order },
      externalReference: {
        findUnique: async () =>
          order ? { metadata: referenceMetadata } : null,
      },
    } as unknown as UnasOrderSyncDatabase;
    return new UnasOrderSyncRepository(fakeDatabase);
  }

  it("returns null for an unknown order id instead of throwing", async () => {
    const repository = repositoryWithOrder(null);
    assert.equal(await repository.findById("missing"), null);
  });

  it("includes the mirrored UNAS invoice in the detail response when one exists", async () => {
    const order: SalesOrderWithRelations = {
      id: "order-1",
      orderNumber: "UNAS-47679-738905",
      status: "CONFIRMED",
      buyerName: "Nagy Péter",
      buyerEmail: "nagy.peter@example.com",
      currency: "HUF",
      totalNet: new Prisma.Decimal("10000"),
      totalTax: new Prisma.Decimal("2700"),
      totalGross: new Prisma.Decimal("12700"),
      orderedAt: new Date("2026-07-20T14:05:00.000Z"),
      createdAt: new Date("2026-07-20T14:06:00.000Z"),
      lines: [],
      unasInvoiceStatus: "BILLED",
      invoices: [
        {
          id: "invoice-1",
          invoiceNumber: "SZ-2026-000123",
          externalUrl: "https://szamlazz.hu/szamla/SZ-2026-000123.pdf",
          syncStatus: "RECEIVED",
          createdAt: new Date("2026-07-21T09:00:00.000Z"),
        },
      ],
    };
    const repository = repositoryWithOrder(order, { unasStatus: "Lezárva" });

    const detail = await repository.findById("order-1");

    assert.equal(detail?.unasInvoiceStatus, "BILLED");
    assert.equal(detail?.invoices.length, 1);
    assert.equal(detail?.invoices[0]?.invoiceNumber, "SZ-2026-000123");
    assert.equal(
      detail?.invoices[0]?.externalUrl,
      "https://szamlazz.hu/szamla/SZ-2026-000123.pdf",
    );
    assert.equal(detail?.unasStatusLabel, "Lezárva");
  });

  it("returns an empty invoices array for an order UNAS has never billed", async () => {
    const order: SalesOrderWithRelations = {
      id: "order-2",
      orderNumber: "UNAS-1002",
      status: "CONFIRMED",
      buyerName: "Kiss Éva",
      buyerEmail: null,
      currency: "HUF",
      totalNet: new Prisma.Decimal("5000"),
      totalTax: new Prisma.Decimal("1350"),
      totalGross: new Prisma.Decimal("6350"),
      orderedAt: new Date("2026-07-22T10:00:00.000Z"),
      createdAt: new Date("2026-07-22T10:01:00.000Z"),
      lines: [],
      unasInvoiceStatus: "BILLABLE",
      invoices: [],
    };
    const repository = repositoryWithOrder(order);

    const detail = await repository.findById("order-2");

    assert.equal(detail?.unasInvoiceStatus, "BILLABLE");
    assert.deepEqual(detail?.invoices, []);
  });
});
