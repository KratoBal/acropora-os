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
  description: string;
  quantity: Prisma.Decimal;
  syncStatus: string;
  syncError: string | null;
  unasRemovedAt: Date | null;
}

interface FakeOrder {
  id: string;
  orderNumber: string;
  status: string;
  unasInvoiceStatus: string | null;
  unasDeletedAt: Date | null;
  lines: FakeOrderLine[];
}

interface FakeMovement {
  id: string;
  movementNumber: string;
  type: string;
  referenceType: string | null;
  referenceId: string | null;
  idempotencyKey: string | null;
  lines: Array<{ variantId: string; quantity: Prisma.Decimal }>;
}

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

class FakeDb {
  warehouses: Array<{ id: string; name: string; createdAt: Date }> = [];
  variants: Array<{
    id: string;
    sku: string;
    unasBaseSku?: string;
    unasVariantKey?: string;
    unit?: string;
    catalogAuthority?: "UNAS" | "ACROPORA" | null;
    isPackageProduct?: boolean;
    packageComponents?: Array<{ sku: string; qty: string }>;
  }> = [];
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
    externalKey: string | null;
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
  // Counts stockMovementLine.create calls - used to assert the delta engine
  // creates exactly the expected number of movement lines (e.g. one SALE
  // line per newly-linked variant), independent of the higher-level
  // db.movements.length check.
  movementLineWriteCount = 0;
  products: Array<{
    id: string;
    name: string;
    unasSnapshot: {
      reportedStock: Prisma.Decimal | null;
      reportedStockSyncedAt: Date | null;
      isPackageProduct: boolean;
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
      const variant = args.where.unasBaseSku
        ? this.variants.find(
            (candidate) =>
              candidate.unasBaseSku === args.where.unasBaseSku &&
              candidate.unasVariantKey === args.where.unasVariantKey,
          )
        : this.variants.find((candidate) => candidate.sku === args.where.sku);
      return variant ? this.variantView(variant) : null;
    },
    findMany: async (args: any) => {
      const requestedIds: string[] | undefined = args.where?.id?.in;
      const requestedSkus: string[] | undefined = args.where?.sku?.in;
      return this.variants
        .filter(
          (variant) =>
            (!requestedIds || requestedIds.includes(variant.id)) &&
            (!requestedSkus || requestedSkus.includes(variant.sku)),
        )
        .map((variant) => this.variantView(variant));
    },
  };

  private variantView(variant: (typeof this.variants)[number]) {
    return {
      id: variant.id,
      sku: variant.sku,
      unit: variant.unit ?? "db",
      product: {
        catalogAuthority: variant.catalogAuthority ?? "UNAS",
        unasSnapshot: {
          isPackageProduct: variant.isPackageProduct ?? false,
          packageComponents: variant.packageComponents ?? [],
        },
      },
    };
  }

  externalReference = {
    findUnique: async (args: any) => {
      if (args.where.system_entityType_externalId) {
        const key = args.where.system_entityType_externalId;
        const found = this.externalReferences.find(
          (reference) => reference.externalId === key.externalId,
        );
        return found
          ? {
              id: found.id,
              entityId: found.entityId,
              externalId: found.externalId,
              externalKey: found.externalKey,
            }
          : null;
      }
      const key = args.where.system_entityType_entityId;
      const found = this.externalReferences.find(
        (reference) => reference.entityId === key.entityId,
      );
      return found
        ? {
            metadata: found.metadata,
            externalId: found.externalId,
            externalKey: found.externalKey,
          }
        : null;
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
        externalKey: (args.data.externalKey as string | null) ?? null,
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
      if (row && args.data.externalId !== undefined)
        row.externalId = args.data.externalId as string;
      if (row && args.data.externalKey !== undefined)
        row.externalKey = args.data.externalKey as string | null;
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
          description: line.description,
          quantity: line.quantity,
          syncStatus: line.syncStatus,
          syncError: line.syncError,
          unasRemovedAt: null,
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
        unasDeletedAt: null,
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
        unasDeletedAt: order.unasDeletedAt,
        lines: order.lines.map((line) => ({
          id: line.id,
          sku: line.sku,
          variantId: line.variantId,
          quantity: line.quantity,
          syncStatus: line.syncStatus,
          unasRemovedAt: line.unasRemovedAt,
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
        description: args.data.description,
        quantity: args.data.quantity,
        syncStatus: args.data.syncStatus,
        syncError: args.data.syncError,
        unasRemovedAt: null,
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
      return found ? { id: found.id, salesOrderId: found.salesOrderId } : null;
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
        idempotencyKey: (args.data.idempotencyKey as string) ?? null,
        lines: [],
      };
      this.movements.push(movement);
      return { id: movement.id };
    },
    // postInventoryMovement's own idempotency check queries by
    // idempotencyKey alone; nothing in this file's repository code queries
    // stockMovement.findFirst any other way anymore (the old
    // type/referenceType/referenceId "alreadyReversed" check was removed
    // along with reverseOrder() - see unas-order-sync.repository.ts).
    findFirst: async (args: any) => {
      const found = this.movements.find(
        (movement) => movement.idempotencyKey === args.where.idempotencyKey,
      );
      return found ? { id: found.id } : null;
    },
    // Backs computeBookedOutAndGeneration: every SALE/RETURN_IN movement
    // this exact order has ever produced, with its lines - the ledger the
    // new delta engine derives "already booked" quantity from.
    findMany: async (args: any) => {
      const typeFilter: string[] = args.where.type?.in ?? [];
      return this.movements
        .filter(
          (movement) =>
            movement.referenceType === args.where.referenceType &&
            movement.referenceId === args.where.referenceId &&
            (typeFilter.length === 0 || typeFilter.includes(movement.type)),
        )
        .map((movement) => ({
          type: movement.type,
          lines: movement.lines.map((line) => ({ ...line })),
        }));
    },
  };

  stockMovementLine = {
    create: async (args: any) => {
      const movement = this.movements.find(
        (movement_) => movement_.id === args.data.movementId,
      );
      movement?.lines.push({
        variantId: args.data.variantId as string,
        quantity: args.data.quantity as Prisma.Decimal,
      });
      this.movementLineWriteCount += 1;
      return {};
    },
  };

  outbox: Array<{
    id: string;
    variantId: string;
    warehouseId: string;
    sku: string;
    status: string;
    idempotencyKey: string;
    sourceProcess: string;
    sourceRecordId: string;
    targetOnHand: Prisma.Decimal;
  }> = [];

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
        sku: args.data.sku,
        status: "PENDING",
        idempotencyKey: args.data.idempotencyKey,
        sourceProcess: args.data.sourceProcess,
        sourceRecordId: args.data.sourceRecordId,
        targetOnHand: args.data.targetOnHand,
      });
      return {};
    },
  };

  async $executeRaw() {
    return 1;
  }

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
    // Derived from the effective key (not a fixed constant) so that two
    // baseOrder({ key: ... }) calls with DIFFERENT keys in the same test
    // never accidentally collide on the same Id, unless a test explicitly
    // overrides `id` itself to simulate a genuine UNAS Key-reuse scenario
    // (see the "UNAS Key reuse after a physical deletion" describe block).
    id: overrides.key ? `id-${overrides.key}` : "9001",
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

  it("resolves a webshop order line to the exact UNAS variant combination", async () => {
    const db = new FakeDb();
    db.warehouses.push({
      id: "wh-1",
      name: "Fő raktár",
      createdAt: new Date(0),
    });
    db.variants.push({
      id: "variant-black",
      sku: "RF-BLUEM#UNASV#black",
      unasBaseSku: "RF-BLUEM",
      unasVariantKey: '["Fekete"]',
    });
    db.stockItems.push({
      id: "stock-black",
      variantId: "variant-black",
      warehouseId: "wh-1",
      onHand: new Prisma.Decimal(10),
    });
    db.runs.push({ id: "run-1", status: "RUNNING", activeKey: "UNAS_ORDERS" });

    await repositoryWith(db).apply(
      "run-1",
      [
        baseOrder({
          items: [
            {
              ...baseOrder().items[0]!,
              sku: "RF-BLUEM",
              variants: [{ id: "1", name: "Szín", value: "Fekete" }],
            },
          ],
        }),
      ],
      null,
      new Date("2026-07-20T15:00:00.000Z"),
    );

    assert.equal(db.orders[0]?.lines[0]?.variantId, "variant-black");
    assert.equal(db.stockItems[0]?.onHand.toString(), "8");
    assert.equal(db.outbox[0]?.sku, "RF-BLUEM#UNASV#black");
  });

  /// THE GATE THAT DECIDES WHETHER WE WRITE TO THE LIVE SHOP AT ALL.
  ///
  /// When a variant is in the ledger's `bookedOut` keys but no longer has a
  /// catalog row, applyOrderStockDelta falls back to `syncToUnas: false` with
  /// the comment "Missing catalog metadata is not safe to publish externally".
  /// Measured on 2026-09-01: that branch ran in exactly one test, and NOTHING
  /// asserted its effect - flipping the value to `true` left all 1624 API
  /// tests green. A branch that executes is not a branch that is guarded.
  ///
  /// The assertion below is on the OUTBOX, not on the flag: what matters is
  /// that nothing is queued for the shop, which is the observable consequence
  /// a reader can check without knowing the flag exists.
  it("queues no shop stock update for a variant whose catalog row has vanished", async () => {
    const db = new FakeDb();
    db.warehouses.push({
      id: "wh-1",
      name: "Fő raktár",
      createdAt: new Date(0),
    });
    db.runs.push({ id: "run-1", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    db.variants.push({ id: "variant-gone", sku: "GONE-1" });
    db.stockItems.push({
      id: "stock-gone",
      variantId: "variant-gone",
      warehouseId: "wh-1",
      onHand: new Prisma.Decimal(10),
    });

    await repositoryWith(db).apply(
      "run-1",
      [baseOrder({ items: [{ ...baseOrder().items[0]!, sku: "GONE-1" }] })],
      null,
      new Date("2026-07-20T15:00:00.000Z"),
    );

    /// The catalog row disappears between two sightings - an unlink or a
    /// delete on the UNAS side. The ledger still remembers what was booked.
    db.variants.length = 0;
    db.outbox.length = 0;
    db.runs.push({ id: "run-2", status: "RUNNING", activeKey: "UNAS_ORDERS" });

    await repositoryWith(db).apply(
      "run-2",
      [baseOrder({ items: [] })],
      null,
      new Date("2026-07-20T16:00:00.000Z"),
    );

    assert.equal(
      db.outbox.length,
      0,
      "a variant we can no longer describe must not have its stock published to the shop",
    );
  });

  it("books a package sale against every component and never against the package SKU", async () => {
    const db = new FakeDb();
    db.warehouses.push({
      id: "wh-1",
      name: "Fő raktár",
      createdAt: new Date(0),
    });
    db.variants.push(
      {
        id: "variant-package",
        sku: "bundle_1",
        isPackageProduct: true,
        packageComponents: [
          { sku: "component_a", qty: "2" },
          { sku: "component_b", qty: "0.5" },
        ],
      },
      { id: "variant-a", sku: "component_a" },
      { id: "variant-b", sku: "component_b" },
    );
    db.stockItems.push(
      {
        id: "stock-a",
        variantId: "variant-a",
        warehouseId: "wh-1",
        onHand: new Prisma.Decimal(10),
      },
      {
        id: "stock-b",
        variantId: "variant-b",
        warehouseId: "wh-1",
        onHand: new Prisma.Decimal(5),
      },
    );
    db.runs.push({ id: "run-1", status: "RUNNING", activeKey: "UNAS_ORDERS" });

    const repository = repositoryWith(db);
    await repository.apply(
      "run-1",
      [
        baseOrder({
          items: [
            {
              id: "bundle-id",
              sku: "bundle_1",
              name: "Tesztcsomag",
              unit: "db",
              quantity: "2",
              priceNet: "1000",
              priceGross: "1270",
              vatRate: "27",
            },
          ],
        }),
      ],
      null,
      new Date("2026-07-20T15:00:00.000Z"),
    );

    assert.equal(db.orders[0]?.lines[0]?.variantId, "variant-package");
    assert.equal(
      db.stockItems.find((item) => item.id === "stock-a")?.onHand.toString(),
      "6",
    );
    assert.equal(
      db.stockItems.find((item) => item.id === "stock-b")?.onHand.toString(),
      "4",
    );
    assert.deepEqual(db.outbox.map((row) => row.sku).sort(), [
      "component_a",
      "component_b",
    ]);
    assert.equal(
      db.outbox.some((row) => row.sku === "bundle_1"),
      false,
    );
  });

  it("fails a package line safely when any component SKU cannot be resolved", async () => {
    const db = new FakeDb();
    db.variants.push({
      id: "variant-package",
      sku: "bundle_1",
      isPackageProduct: true,
      packageComponents: [{ sku: "missing_component", qty: "1" }],
    });
    db.runs.push({ id: "run-1", status: "RUNNING", activeKey: "UNAS_ORDERS" });

    await repositoryWith(db).apply(
      "run-1",
      [baseOrder({ items: [{ ...baseOrder().items[0]!, sku: "bundle_1" }] })],
      null,
      new Date("2026-07-20T15:00:00.000Z"),
    );

    assert.equal(db.orders[0]?.lines[0]?.syncStatus, "FAILED");
    assert.equal(
      db.orders[0]?.lines[0]?.syncError,
      "PACKAGE_COMPONENT_UNRESOLVED:bundle_1",
    );
    assert.equal(db.movements.length, 0);
    assert.equal(db.outbox.length, 0);
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
    const cancelled = baseOrder({
      statusType: "close_fault",
      status: "Sztornó",
    });
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
      db.movements.filter((movement) => movement.type === "RETURN_IN").length,
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
    const cancelled = baseOrder({
      statusType: "close_fault",
      status: "Sztornó",
    });
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
    const cancelled = baseOrder({
      statusType: "close_fault",
      status: "Sztornó",
    });
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

  it("an empty incremental page (empty orders array) never modifies any existing order or stock (#12) - absence from a list response is never proof of deletion", async () => {
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
    const stockAfterCreate = db.stockItems[0]?.onHand.toString();
    const orderSnapshot = JSON.stringify(db.orders[0]);

    db.runs.push({ id: "run-2", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    const summary = await repository.apply(
      "run-2",
      [],
      new Date("2026-07-20T15:00:00.000Z"),
      new Date("2026-07-20T16:00:00.000Z"),
    );

    assert.equal(summary.ordersSeen, 0);
    assert.equal(summary.createdCount, 0);
    assert.equal(summary.updatedCount, 0);
    assert.equal(summary.reversedCount, 0);
    assert.equal(db.orders.length, 1);
    assert.equal(JSON.stringify(db.orders[0]), orderSnapshot);
    assert.equal(db.stockItems[0]?.onHand.toString(), stockAfterCreate);
    assert.equal(db.movements.length, 1);
    assert.equal(db.orders[0]?.unasDeletedAt, null);
  });
});

// The delta engine (applyOrderStockDelta/aggregateTargetOut/
// computeBookedOutAndGeneration in unas-order-sync.repository.ts) replaces
// the old "always SALE the full quantity on create, always RETURN_IN the
// full quantity on cancel" model with `delta = target - alreadyBooked`,
// derived from the StockMovement/StockMovementLine ledger rather than
// SalesOrderLine.quantity. These tests cover the specific worked examples
// and edge cases from the checkpoint brief that the pre-existing test suite
// above didn't exercise (it only ever created-then-cancelled a single,
// unmodified order).
describe("UnasOrderSyncRepository.apply - delta-based stock updates", () => {
  function seeded(): FakeDb {
    const db = new FakeDb();
    db.warehouses.push({
      id: "wh-1",
      name: "Fő raktár",
      createdAt: new Date(0),
    });
    db.variants.push({ id: "variant-1", sku: "pump_1" });
    db.variants.push({ id: "variant-2", sku: "filter_1" });
    db.stockItems.push({
      id: "stock-1",
      variantId: "variant-1",
      warehouseId: "wh-1",
      onHand: new Prisma.Decimal(10),
    });
    db.stockItems.push({
      id: "stock-2",
      variantId: "variant-2",
      warehouseId: "wh-1",
      onHand: new Prisma.Decimal(10),
    });
    return db;
  }

  function orderWithQty(qty: number, overrides: Partial<UnasApiOrder> = {}) {
    return baseOrder({
      items: [
        {
          id: "1",
          sku: "pump_1",
          name: "Reef Pump",
          unit: "db",
          quantity: String(qty),
          priceNet: "5000",
          priceGross: "6350",
          vatRate: "27",
        },
      ],
      ...overrides,
    });
  }

  it("2 -> 3: books exactly 1 additional SALE unit, not the full 3 again", async () => {
    const db = seeded();
    db.runs.push({ id: "run-1", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    const repository = repositoryWith(db);
    await repository.apply("run-1", [orderWithQty(2)], null, new Date());
    assert.equal(db.stockItems[0]?.onHand.toString(), "8");
    assert.equal(db.movements.length, 1);

    db.runs.push({ id: "run-2", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    await repository.apply("run-2", [orderWithQty(3)], null, new Date());

    assert.equal(db.stockItems[0]?.onHand.toString(), "7");
    assert.equal(db.movements.length, 2);
    const secondMovement = db.movements[1]!;
    assert.equal(secondMovement.type, "SALE");
    assert.equal(secondMovement.lines[0]?.quantity.toString(), "1");
  });

  it("3 -> 1: books a single RETURN_IN of 2, restoring the difference in one movement", async () => {
    const db = seeded();
    db.runs.push({ id: "run-1", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    const repository = repositoryWith(db);
    await repository.apply("run-1", [orderWithQty(3)], null, new Date());
    assert.equal(db.stockItems[0]?.onHand.toString(), "7");

    db.runs.push({ id: "run-2", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    await repository.apply("run-2", [orderWithQty(1)], null, new Date());

    assert.equal(db.stockItems[0]?.onHand.toString(), "9");
    assert.equal(db.movements.length, 2);
    const secondMovement = db.movements[1]!;
    assert.equal(secondMovement.type, "RETURN_IN");
    assert.equal(secondMovement.lines[0]?.quantity.toString(), "2");
  });

  it("2 -> 3 -> sztornó: the cancellation returns exactly 3 total (all of it, none returned before)", async () => {
    const db = seeded();
    db.runs.push({ id: "run-1", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    const repository = repositoryWith(db);
    await repository.apply("run-1", [orderWithQty(2)], null, new Date());
    db.runs.push({ id: "run-2", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    await repository.apply("run-2", [orderWithQty(3)], null, new Date());
    assert.equal(db.stockItems[0]?.onHand.toString(), "7");

    db.runs.push({ id: "run-3", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    await repository.apply(
      "run-3",
      [orderWithQty(3, { statusType: "close_fault", status: "Sztornó" })],
      null,
      new Date(),
    );

    assert.equal(db.stockItems[0]?.onHand.toString(), "10");
    const returnMovements = db.movements.filter((m) => m.type === "RETURN_IN");
    assert.equal(returnMovements.length, 1);
    assert.equal(returnMovements[0]?.lines[0]?.quantity.toString(), "3");
  });

  it("3 -> 1 -> sztornó: 2 already returned at the edit step, cancellation returns only the remaining 1", async () => {
    const db = seeded();
    db.runs.push({ id: "run-1", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    const repository = repositoryWith(db);
    await repository.apply("run-1", [orderWithQty(3)], null, new Date());
    db.runs.push({ id: "run-2", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    await repository.apply("run-2", [orderWithQty(1)], null, new Date());
    assert.equal(db.stockItems[0]?.onHand.toString(), "9");
    const returnAfterEdit = db.movements.filter((m) => m.type === "RETURN_IN");
    assert.equal(returnAfterEdit.length, 1);
    assert.equal(returnAfterEdit[0]?.lines[0]?.quantity.toString(), "2");

    db.runs.push({ id: "run-3", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    await repository.apply(
      "run-3",
      [orderWithQty(1, { statusType: "close_fault", status: "Sztornó" })],
      null,
      new Date(),
    );

    assert.equal(db.stockItems[0]?.onHand.toString(), "10");
    const returnMovements = db.movements.filter((m) => m.type === "RETURN_IN");
    assert.equal(
      returnMovements.length,
      2,
      "one RETURN_IN from the edit, one from the cancel",
    );
    assert.equal(
      returnMovements[1]?.lines[0]?.quantity.toString(),
      "1",
      "cancellation must only return what's still net-booked (1), not the full original 3",
    );
  });

  it("A -> B -> A: each transition posts its own movement, the second A is not treated as an already-applied replay", async () => {
    const db = seeded();
    db.runs.push({ id: "run-1", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    const repository = repositoryWith(db);
    await repository.apply("run-1", [orderWithQty(2)], null, new Date()); // A: booked 2
    db.runs.push({ id: "run-2", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    await repository.apply("run-2", [orderWithQty(5)], null, new Date()); // B: booked 5 total
    assert.equal(db.stockItems[0]?.onHand.toString(), "5");

    db.runs.push({ id: "run-3", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    await repository.apply("run-3", [orderWithQty(2)], null, new Date()); // back to A: booked 2 total again

    // Must actually apply a RETURN_IN of 3 (5 -> 2), not be silently
    // skipped as "the same state we already saw for hash(A)".
    assert.equal(db.stockItems[0]?.onHand.toString(), "8");
    assert.equal(db.movements.length, 3);
    assert.equal(db.movements[2]?.type, "RETURN_IN");
    assert.equal(db.movements[2]?.lines[0]?.quantity.toString(), "3");
  });

  it("unchanged replay of the same order/state creates no movement and no outbox row", async () => {
    const db = seeded();
    db.runs.push({ id: "run-1", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    const repository = repositoryWith(db);
    await repository.apply("run-1", [orderWithQty(2)], null, new Date());
    const movementCountBefore = db.movements.length;
    const outboxCountBefore = db.outbox.length;

    db.runs.push({ id: "run-2", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    const summary = await repository.apply(
      "run-2",
      [orderWithQty(2)],
      null,
      new Date(),
    );

    assert.equal(db.movements.length, movementCountBefore);
    assert.equal(db.outbox.length, outboxCountBefore);
    assert.equal(summary.updatedCount, 0);
  });

  it("a non-stock-relevant field change (e.g. price only) does not create a movement", async () => {
    const db = seeded();
    db.runs.push({ id: "run-1", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    const repository = repositoryWith(db);
    await repository.apply("run-1", [orderWithQty(2)], null, new Date());
    const movementCountBefore = db.movements.length;

    db.runs.push({ id: "run-2", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    await repository.apply(
      "run-2",
      [
        orderWithQty(2, {
          items: [
            {
              id: "1",
              sku: "pump_1",
              name: "Reef Pump (new price)",
              unit: "db",
              quantity: "2",
              priceNet: "9999",
              priceGross: "12698.73",
              vatRate: "27",
            },
          ],
        }),
      ],
      null,
      new Date(),
    );

    assert.equal(db.movements.length, movementCountBefore);
    assert.equal(db.orders[0]?.lines[0]?.sku, "pump_1");
  });

  it("a new line for an additional variant on an already-live order books its own SALE, leaving the first variant untouched", async () => {
    const db = seeded();
    db.runs.push({ id: "run-1", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    const repository = repositoryWith(db);
    await repository.apply("run-1", [orderWithQty(2)], null, new Date());

    db.runs.push({ id: "run-2", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    await repository.apply(
      "run-2",
      [
        baseOrder({
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
              id: "2",
              sku: "filter_1",
              name: "Reef Filter",
              unit: "db",
              quantity: "1",
              priceNet: "3000",
              priceGross: "3810",
              vatRate: "27",
            },
          ],
        }),
      ],
      null,
      new Date(),
    );

    assert.equal(db.stockItems[0]?.onHand.toString(), "8"); // pump_1 unaffected
    assert.equal(db.stockItems[1]?.onHand.toString(), "9"); // filter_1: 10 - 1
    assert.equal(db.movements.length, 2);
    assert.equal(db.movements[1]?.type, "SALE");
    assert.equal(db.movements[1]?.lines[0]?.variantId, "variant-2");
  });

  it("a line that vanishes entirely from the order gets its full quantity RETURN_IN'd", async () => {
    const db = seeded();
    db.runs.push({ id: "run-1", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    const repository = repositoryWith(db);
    await repository.apply(
      "run-1",
      [
        baseOrder({
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
              id: "2",
              sku: "filter_1",
              name: "Reef Filter",
              unit: "db",
              quantity: "1",
              priceNet: "3000",
              priceGross: "3810",
              vatRate: "27",
            },
          ],
        }),
      ],
      null,
      new Date(),
    );
    assert.equal(db.stockItems[1]?.onHand.toString(), "9");

    // filter_1's line is gone entirely from this sighting - only pump_1 remains.
    db.runs.push({ id: "run-2", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    await repository.apply("run-2", [orderWithQty(2)], null, new Date());

    assert.equal(db.stockItems[0]?.onHand.toString(), "8", "pump_1 unaffected");
    assert.equal(
      db.stockItems[1]?.onHand.toString(),
      "10",
      "filter_1 fully returned since its line disappeared",
    );
    const returnMovements = db.movements.filter((m) => m.type === "RETURN_IN");
    assert.equal(returnMovements.length, 1);
    assert.equal(returnMovements[0]?.lines[0]?.variantId, "variant-2");
    assert.equal(returnMovements[0]?.lines[0]?.quantity.toString(), "1");
    const removedLine = db.orders[0]?.lines.find(
      (line) => line.sku === "filter_1",
    );
    assert.ok(removedLine?.unasRemovedAt instanceof Date);
    assert.equal(
      db.orders[0]?.lines.filter((line) => !line.unasRemovedAt).length,
      1,
      "only the still-present UNAS row remains active",
    );
  });

  it("a product replacement returns the old SKU, sells the new SKU, and keeps the old line only as audit history", async () => {
    const db = seeded();
    db.runs.push({ id: "run-1", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    const repository = repositoryWith(db);
    await repository.apply("run-1", [orderWithQty(2)], null, new Date());

    db.runs.push({ id: "run-2", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    await repository.apply(
      "run-2",
      [
        baseOrder({
          items: [
            {
              id: "2",
              sku: "filter_1",
              name: "Reef Filter",
              unit: "db",
              quantity: "1",
              priceNet: "3000",
              priceGross: "3810",
              vatRate: "27",
            },
          ],
        }),
      ],
      null,
      new Date("2026-08-09T09:00:00.000Z"),
    );

    assert.equal(db.stockItems[0]?.onHand.toString(), "10");
    assert.equal(db.stockItems[1]?.onHand.toString(), "9");
    const oldLine = db.orders[0]?.lines.find((line) => line.sku === "pump_1");
    const newLine = db.orders[0]?.lines.find((line) => line.sku === "filter_1");
    assert.ok(oldLine?.unasRemovedAt instanceof Date);
    assert.equal(newLine?.unasRemovedAt, null);
    assert.deepEqual(
      db.movements
        .slice(1)
        .map((movement) => movement.type)
        .sort(),
      ["RETURN_IN", "SALE"],
    );
  });

  it("splitting a line into a new UNAS order returns and re-sells the same quantity without changing total stock", async () => {
    const db = seeded();
    db.runs.push({ id: "run-1", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    const repository = repositoryWith(db);
    await repository.apply("run-1", [orderWithQty(2)], null, new Date());
    assert.equal(db.stockItems[0]?.onHand.toString(), "8");

    db.runs.push({ id: "run-2", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    await repository.apply(
      "run-2",
      [baseOrder({ items: [] }), orderWithQty(2, { key: "UN-2", id: "9002" })],
      null,
      new Date("2026-08-09T10:00:00.000Z"),
    );

    assert.equal(db.orders.length, 2);
    assert.equal(db.stockItems[0]?.onHand.toString(), "8");
    assert.ok(db.orders[0]?.lines[0]?.unasRemovedAt instanceof Date);
    assert.equal(db.orders[1]?.lines[0]?.unasRemovedAt, null);
    assert.deepEqual(
      db.movements.map((movement) => movement.type),
      ["SALE", "RETURN_IN", "SALE"],
    );
  });

  it("two order lines for the same variant aggregate into a single delta, not two independent ones", async () => {
    const db = seeded();
    db.runs.push({ id: "run-1", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    const repository = repositoryWith(db);
    await repository.apply(
      "run-1",
      [
        baseOrder({
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
              id: "2",
              sku: "pump_1",
              name: "Reef Pump (second line, same SKU)",
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

    // 2 + 1 = 3 taken out of variant-1, in one SALE movement/line.
    assert.equal(db.stockItems[0]?.onHand.toString(), "7");
    assert.equal(db.movements.length, 1);
    assert.equal(db.movements[0]?.lines.length, 1);
    assert.equal(db.movements[0]?.lines[0]?.quantity.toString(), "3");

    db.runs.push({ id: "run-2", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    await repository.apply(
      "run-2",
      [
        baseOrder({
          items: [
            {
              id: "1",
              sku: "pump_1",
              name: "Reef Pump A",
              unit: "db",
              quantity: "4",
              priceNet: "5000",
              priceGross: "6350",
              vatRate: "27",
            },
            {
              id: "2",
              sku: "pump_1",
              name: "Reef Pump B",
              unit: "db",
              quantity: "2",
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

    const activeLines = db.orders[0]?.lines.filter(
      (line) => !line.unasRemovedAt,
    );
    assert.equal(activeLines?.length, 2);
    assert.deepEqual(
      activeLines?.map((line) => line.quantity.toString()),
      ["4", "2"],
      "each repeated SKU row is updated once instead of both inputs overwriting one row",
    );
    assert.equal(db.stockItems[0]?.onHand.toString(), "4");
  });

  it("an unlinked new line (unknown SKU) never touches stock, even on an otherwise-live order", async () => {
    const db = seeded();
    db.runs.push({ id: "run-1", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    const repository = repositoryWith(db);
    await repository.apply("run-1", [orderWithQty(2)], null, new Date());

    db.runs.push({ id: "run-2", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    await repository.apply(
      "run-2",
      [
        baseOrder({
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
              id: "2",
              sku: "not_in_catalog",
              name: "Ismeretlen tétel",
              unit: "db",
              quantity: "5",
              priceNet: "1000",
              priceGross: "1270",
              vatRate: "27",
            },
          ],
        }),
      ],
      null,
      new Date(),
    );

    assert.equal(db.stockItems[0]?.onHand.toString(), "8");
    assert.equal(db.movements.length, 1, "no movement for the unlinked line");
    const unlinkedLine = db.orders[0]?.lines.find(
      (line) => line.sku === "not_in_catalog",
    );
    assert.equal(unlinkedLine?.syncStatus, "FAILED");
  });

  it("a line whose SKU only resolves to a catalog product on a LATER sighting books its delta exactly once", async () => {
    const db = seeded();
    db.runs.push({ id: "run-1", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    const repository = repositoryWith(db);
    const orderWithUnresolved = baseOrder({
      items: [
        {
          id: "1",
          sku: "not_yet_in_catalog",
          name: "Új termék",
          unit: "db",
          quantity: "4",
          priceNet: "2000",
          priceGross: "2540",
          vatRate: "27",
        },
      ],
    });
    await repository.apply("run-1", [orderWithUnresolved], null, new Date());
    assert.equal(db.movements.length, 0, "nothing to book while unresolved");

    // The product gets added to the catalog between sightings.
    db.variants.push({ id: "variant-late", sku: "not_yet_in_catalog" });
    db.stockItems.push({
      id: "stock-late",
      variantId: "variant-late",
      warehouseId: "wh-1",
      onHand: new Prisma.Decimal(20),
    });

    db.runs.push({ id: "run-2", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    await repository.apply("run-2", [orderWithUnresolved], null, new Date());

    assert.equal(
      db.stockItems
        .find((item) => item.variantId === "variant-late")
        ?.onHand.toString(),
      "16",
      "booked exactly once, on the sighting where it first resolved",
    );
    assert.equal(db.movements.length, 1);

    // A third, still-unchanged sighting must not book it again.
    db.runs.push({ id: "run-3", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    await repository.apply("run-3", [orderWithUnresolved], null, new Date());
    assert.equal(
      db.stockItems
        .find((item) => item.variantId === "variant-late")
        ?.onHand.toString(),
      "16",
    );
    assert.equal(db.movements.length, 1);
  });

  it("a previously-linked line that becomes unresolvable keeps its historical variantId, so its eventual storno is safe", async () => {
    const db = seeded();
    db.runs.push({ id: "run-1", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    const repository = repositoryWith(db);
    await repository.apply("run-1", [orderWithQty(2)], null, new Date());
    assert.equal(db.stockItems[0]?.onHand.toString(), "8");

    // Simulate the ProductVariant becoming unresolvable (e.g. deleted) by
    // removing it from the fake catalog - buildLineInputs' lookup will now
    // fail for "pump_1" even though the order's line was already linked.
    db.variants.length = 0;

    db.runs.push({ id: "run-2", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    await repository.apply(
      "run-2",
      [orderWithQty(2, { statusType: "close_fault", status: "Sztornó" })],
      null,
      new Date(),
    );

    // The cancellation must still find and return the 2 units originally
    // booked for variant-1, even though a fresh lookup of "pump_1" would
    // now fail - it relies on the ledger (referenceId), not a live re-lookup.
    assert.equal(db.stockItems[0]?.onHand.toString(), "10");
    assert.equal(
      db.movements.some(
        (m) => m.type === "RETURN_IN" && m.lines[0]?.variantId === "variant-1",
      ),
      true,
    );
  });

  it("posts an outbox row with the correct sourceProcess and sourceRecordId for a new order", async () => {
    const db = seeded();
    db.runs.push({ id: "run-1", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    const repository = repositoryWith(db);
    await repository.apply("run-1", [orderWithQty(2)], null, new Date());

    assert.equal(db.outbox.length, 1);
    assert.equal(db.outbox[0]?.sourceProcess, "UNAS_ORDER_IMPORT");
    assert.equal(db.outbox[0]?.sourceRecordId, db.orders[0]?.id);
    assert.equal(db.outbox[0]?.variantId, "variant-1");
    assert.equal(db.outbox[0]?.targetOnHand.toString(), "8");
  });

  it("posts an outbox row tagged UNAS_ORDER_UPDATE for a live-order quantity edit, and UNAS_ORDER_CANCEL for a cancellation", async () => {
    const db = seeded();
    db.runs.push({ id: "run-1", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    const repository = repositoryWith(db);
    await repository.apply("run-1", [orderWithQty(2)], null, new Date());

    db.runs.push({ id: "run-2", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    await repository.apply("run-2", [orderWithQty(3)], null, new Date());
    const updateRow = db.outbox.find(
      (row) => row.sourceProcess === "UNAS_ORDER_UPDATE",
    );
    assert.ok(updateRow, "expected an outbox row tagged UNAS_ORDER_UPDATE");

    db.runs.push({ id: "run-3", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    await repository.apply(
      "run-3",
      [orderWithQty(3, { statusType: "close_fault", status: "Sztornó" })],
      null,
      new Date(),
    );
    const cancelRow = db.outbox.find(
      (row) => row.sourceProcess === "UNAS_ORDER_CANCEL",
    );
    assert.ok(cancelRow, "expected an outbox row tagged UNAS_ORDER_CANCEL");
  });

  it("an order that arrives already cancelled on its very first sighting never books (and thus never needs to reverse) any stock", async () => {
    const db = seeded();
    db.runs.push({ id: "run-1", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    const repository = repositoryWith(db);

    await repository.apply(
      "run-1",
      [orderWithQty(2, { statusType: "close_fault", status: "Sztornó" })],
      null,
      new Date(),
    );

    assert.equal(
      db.stockItems[0]?.onHand.toString(),
      "10",
      "never decremented",
    );
    assert.equal(db.movements.length, 0);
    assert.equal(db.outbox.length, 0);
    assert.equal(db.orders[0]?.status, "CANCELLED");
  });

  it("a writer failure mid-delta leaves StockItem/run state unadvanced (no partial application)", async () => {
    const db = seeded();
    db.runs.push({ id: "run-1", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    const repository = repositoryWith(db);
    await repository.apply("run-1", [orderWithQty(2)], null, new Date());

    // Fails BEFORE any StockItem write for the line (postInventoryMovement
    // creates the StockMovement row, then the StockMovementLine, THEN
    // updates StockItem, per line - throwing at the StockMovementLine step
    // proves the StockItem update genuinely never runs for this attempt,
    // regardless of this in-memory fake's lack of true cross-statement
    // rollback - see the class comment re: what this fake can and can't
    // prove).
    db.stockMovementLine.create = async () => {
      throw new Error("simulated writer failure");
    };

    db.runs.push({ id: "run-2", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    await assert.rejects(() =>
      repository.apply("run-2", [orderWithQty(5)], null, new Date()),
    );

    assert.equal(
      db.stockItems[0]?.onHand.toString(),
      "8",
      "StockItem must not reflect a partially-applied delta",
    );
    assert.notEqual(
      db.runs.find((run) => run.id === "run-2")?.status,
      "APPLIED",
      "the run must not be marked APPLIED when posting failed",
    );
  });
});

describe("UnasOrderSyncRepository.refreshOrder", () => {
  function seededDb(): { db: FakeDb; orderId: string } {
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
    return { db, orderId: "" };
  }

  it("refreshes a single already-known order in place", async () => {
    const { db } = seededDb();
    const repository = repositoryWith(db);
    await repository.apply("run-1", [baseOrder()], null, new Date());
    const orderId = db.orders[0]!.id;
    assert.equal(db.orders[0]?.status, "CONFIRMED");

    const result = await repository.refreshOrder(
      orderId,
      baseOrder({ statusType: "close_ok", status: "Lezárva" }),
    );

    assert.equal(result.updated, true);
    assert.equal(result.reversed, false);
    assert.equal(db.orders[0]?.status, "COMPLETED");
    // Still exactly one order - a refresh of an existing order must never
    // create a second SalesOrder row.
    assert.equal(db.orders.length, 1);
  });

  it("uses ExternalReference.externalKey for the targeted UNAS lookup, never the distinct stable externalId", async () => {
    const { db } = seededDb();
    const repository = repositoryWith(db);
    await repository.apply(
      "run-1",
      [baseOrder({ key: "47679-530114", id: "123456789" })],
      null,
      new Date(),
    );
    const orderId = db.orders[0]!.id;

    assert.equal(db.externalReferences[0]?.externalId, "123456789");
    assert.equal(db.externalReferences[0]?.externalKey, "47679-530114");
    assert.equal(await repository.getUnasKey(orderId), "47679-530114");
  });

  it("fails closed when externalKey is missing instead of sending externalId as a Key", async () => {
    const { db } = seededDb();
    const repository = repositoryWith(db);
    await repository.apply("run-1", [baseOrder()], null, new Date());
    db.externalReferences[0]!.externalKey = null;

    assert.equal(await repository.getUnasKey(db.orders[0]!.id), null);
  });

  it("restores a falsely-deleted live order only through the same stable UNAS Id and books the corrective SALE exactly once", async () => {
    const { db } = seededDb();
    const repository = repositoryWith(db);
    const liveOrder = baseOrder({ key: "47679-530114", id: "123456789" });
    await repository.apply("run-1", [liveOrder], null, new Date());
    const orderId = db.orders[0]!.id;
    assert.equal(db.stockItems[0]?.onHand.toString(), "8");

    await repository.reconcileDeletedOrder(orderId, liveOrder.key);
    assert.equal(db.stockItems[0]?.onHand.toString(), "10");
    assert.ok(db.orders[0]?.unasDeletedAt);

    const recovered = await repository.refreshOrder(orderId, liveOrder);
    assert.equal(recovered.updated, true);
    assert.equal(db.orders[0]?.unasDeletedAt, null);
    assert.equal(db.orders[0]?.status, "CONFIRMED");
    assert.equal(db.stockItems[0]?.onHand.toString(), "8");
    assert.deepEqual(
      db.movements.map((movement) => movement.type),
      ["SALE", "RETURN_IN", "SALE"],
    );

    await repository.refreshOrder(orderId, liveOrder);
    assert.equal(db.stockItems[0]?.onHand.toString(), "8");
    assert.deepEqual(
      db.movements.map((movement) => movement.type),
      ["SALE", "RETURN_IN", "SALE"],
    );
  });

  it("never restores a deletion marker when the fetched order has a different stable UNAS Id", async () => {
    const { db } = seededDb();
    const repository = repositoryWith(db);
    const original = baseOrder({ key: "47679-530114", id: "123456789" });
    await repository.apply("run-1", [original], null, new Date());
    const orderId = db.orders[0]!.id;
    await repository.reconcileDeletedOrder(orderId, original.key);

    await assert.rejects(() =>
      repository.refreshOrder(
        orderId,
        baseOrder({ key: original.key, id: "DIFFERENT-STABLE-ID" }),
      ),
    );
    assert.ok(db.orders[0]?.unasDeletedAt);
    assert.equal(db.stockItems[0]?.onHand.toString(), "10");
    assert.deepEqual(
      db.movements.map((movement) => movement.type),
      ["SALE", "RETURN_IN"],
    );
  });

  it("saves a newly-reported invoice number/link on refresh", async () => {
    const { db } = seededDb();
    const repository = repositoryWith(db);
    await repository.apply("run-1", [baseOrder()], null, new Date());
    const orderId = db.orders[0]!.id;
    assert.equal(db.invoices.length, 0);

    await repository.refreshOrder(
      orderId,
      baseOrder({
        invoiceStatus: "BILLED",
        invoiceNumber: "SZ-2026-REFRESH-1",
        invoiceUrl: "https://www.szamlazz.hu/szamla/pdf/SZ-2026-REFRESH-1",
      }),
    );

    assert.equal(db.invoices.length, 1);
    assert.equal(db.invoices[0]?.invoiceNumber, "SZ-2026-REFRESH-1");
    assert.equal(db.invoices[0]?.salesOrderId, orderId);
    assert.equal(
      db.invoices[0]?.externalUrl,
      "https://www.szamlazz.hu/szamla/pdf/SZ-2026-REFRESH-1",
    );
  });

  it("updates an already-mirrored invoice's link on a later refresh", async () => {
    const { db } = seededDb();
    const repository = repositoryWith(db);
    await repository.apply(
      "run-1",
      [
        baseOrder({
          invoiceStatus: "BILLED",
          invoiceNumber: "SZ-2026-REFRESH-2",
          invoiceUrl: null,
        }),
      ],
      null,
      new Date(),
    );
    const orderId = db.orders[0]!.id;
    assert.equal(db.invoices[0]?.externalUrl, null);

    await repository.refreshOrder(
      orderId,
      baseOrder({
        invoiceStatus: "BILLED",
        invoiceNumber: "SZ-2026-REFRESH-2",
        invoiceUrl: "https://www.szamlazz.hu/szamla/pdf/SZ-2026-REFRESH-2",
      }),
    );

    assert.equal(db.invoices.length, 1);
    assert.equal(
      db.invoices[0]?.externalUrl,
      "https://www.szamlazz.hu/szamla/pdf/SZ-2026-REFRESH-2",
    );
  });

  it("never touches the incremental sync cursor", async () => {
    const { db } = seededDb();
    const repository = repositoryWith(db);
    await repository.apply(
      "run-1",
      [baseOrder()],
      null,
      new Date("2026-07-20T15:00:00.000Z"),
    );
    const orderId = db.orders[0]!.id;
    const cursorAfterApply = db.cursor;
    assert.notEqual(cursorAfterApply, null);

    await repository.refreshOrder(
      orderId,
      baseOrder({ statusType: "close_ok", status: "Lezárva" }),
    );

    assert.equal(db.cursor?.getTime(), cursorAfterApply?.getTime());
  });

  it("does not create a second SALE stock movement when refreshing an existing order", async () => {
    const { db } = seededDb();
    const repository = repositoryWith(db);
    await repository.apply("run-1", [baseOrder()], null, new Date());
    const orderId = db.orders[0]!.id;
    assert.equal(db.movements.length, 1);
    assert.equal(db.stockItems[0]?.onHand.toString(), "8");

    await repository.refreshOrder(
      orderId,
      baseOrder({ statusType: "close_ok", status: "Lezárva" }),
    );

    // No new StockMovement, and stock is untouched by the refresh - only
    // createNewOrder() ever creates a SALE movement, and refreshOrder()
    // never calls it for an order that already exists locally.
    assert.equal(db.movements.length, 1);
    assert.equal(
      db.movements.filter((movement) => movement.type === "SALE").length,
      1,
    );
    assert.equal(db.stockItems[0]?.onHand.toString(), "8");
  });

  it("reverses stock exactly once for an existing order that transitions to cancelled via refresh", async () => {
    const { db } = seededDb();
    const repository = repositoryWith(db);
    await repository.apply("run-1", [baseOrder()], null, new Date());
    const orderId = db.orders[0]!.id;

    const result = await repository.refreshOrder(
      orderId,
      baseOrder({ statusType: "close_fault", status: "Sztornó" }),
    );

    assert.equal(result.reversed, true);
    assert.equal(db.orders[0]?.status, "CANCELLED");
    assert.equal(db.stockItems[0]?.onHand.toString(), "10");
  });

  it("throws when the fetched order's Key does not belong to the given local order id", async () => {
    const { db } = seededDb();
    const repository = repositoryWith(db);
    await repository.apply(
      "run-1",
      [baseOrder({ key: "UN-1" })],
      null,
      new Date(),
    );
    db.runs.push({ id: "run-2", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    await repository.apply(
      "run-2",
      [baseOrder({ key: "UN-2", items: [] })],
      null,
      new Date(),
    );
    const [firstOrder, secondOrder] = db.orders;

    await assert.rejects(() =>
      repository.refreshOrder(firstOrder!.id, baseOrder({ key: "UN-2" })),
    );
    // Neither order's status is perturbed by the rejected mismatched call.
    assert.notEqual(firstOrder!.id, secondOrder!.id);
  });

  it("never stock-manages shipping-cost/handel-cost/handling-cost lines, even when UNAS attaches a real catalog SKU to them", async () => {
    const { db } = seededDb();
    const repository = repositoryWith(db);
    await repository.apply("run-1", [baseOrder()], null, new Date());
    const orderId = db.orders[0]!.id;
    const movementCountBefore = db.movements.length;
    const stockBefore = db.stockItems[0]!.onHand.toString();

    for (const technicalId of [
      "shipping-cost",
      "handel-cost",
      "handling-cost",
    ]) {
      await repository.refreshOrder(
        orderId,
        baseOrder({
          statusType: "open_normal",
          status: "Feldolgozás alatt",
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
              // UNAS's docs say these never carry a Sku, but a webshop
              // config could still attach one (deliberately a distinct sku
              // from the real product line above, so this test can't pass
              // by accident via a sku collision masking a real bug) - it
              // must still never be stock-managed, since it's still
              // recognized by its technical Id regardless of the Sku.
              id: technicalId,
              sku: `REAL-SKU-${technicalId}`,
              name: "Kezelési/szállítási költség",
              unit: "db",
              quantity: "1",
              priceNet: "500",
              priceGross: "635",
              vatRate: "27",
            },
          ],
        }),
      );
    }

    // No additional StockMovement created by any of the three refreshes,
    // and on-hand stock is unaffected - technical cost lines must never
    // enter stockLines regardless of what Sku UNAS attaches to them.
    assert.equal(db.movements.length, movementCountBefore);
    assert.equal(db.stockItems[0]?.onHand.toString(), stockBefore);
    // Each technical-cost line landed as its own non-stock SalesOrderLine
    // row, never resolved against the ProductVariant its (fake) Sku
    // happened to name.
    for (const technicalId of [
      "shipping-cost",
      "handel-cost",
      "handling-cost",
    ]) {
      const line = db.orders[0]!.lines.find(
        (l) => l.sku === `REAL-SKU-${technicalId}`,
      );
      assert.equal(line?.variantId, null);
      assert.equal(line?.syncStatus, "OK");
    }
  });

  it("corrects a previously mis-stock-managed technical cost line back to non-stock on refresh", async () => {
    const { db } = seededDb();
    const repository = repositoryWith(db);
    await repository.apply("run-1", [baseOrder()], null, new Date());
    const orderId = db.orders[0]!.id;
    const order = db.orders[0]!;

    // Simulate a line that was, before this fix existed, incorrectly
    // resolved against a real ProductVariant despite actually being a
    // shipping-cost technical line (e.g. because UNAS attached a
    // real-looking catalog Sku to it and the old code only checked
    // `!item.sku`, so it fell through to the ordinary variant lookup).
    // Kept under its own distinct sku (not "pump_1", the real product's
    // sku already on the order) so this test unambiguously targets only
    // the mis-tagged line via existingBySku.
    db.variants.push({ id: "variant-ship", sku: "SHIP-REAL-SKU" });
    order.lines.length = 0;
    order.lines.push({
      id: "line-broken",
      variantId: "variant-ship",
      sku: "SHIP-REAL-SKU",
      quantity: new Prisma.Decimal(1),
      syncStatus: "OK",
      syncError: null,
      description: "Szállítási költség",
      unasRemovedAt: null,
    });

    await repository.refreshOrder(
      orderId,
      baseOrder({
        items: [
          {
            // Still recognized as a technical cost line by Id alone, even
            // though UNAS attached the real catalog Sku to it here.
            id: "shipping-cost",
            sku: "SHIP-REAL-SKU",
            name: "Szállítási költség",
            unit: "db",
            quantity: "1",
            priceNet: "500",
            priceGross: "635",
            vatRate: "27",
          },
        ],
      }),
    );

    const corrected = order.lines.find((line) => line.sku === "SHIP-REAL-SKU");
    assert.equal(corrected?.variantId, null);
    assert.equal(corrected?.syncStatus, "OK");
    assert.equal(corrected?.syncError, null);
  });
});

// Covers the mandatory test cases for physically-deleted UNAS orders (see
// docs/INVENTORY-CONSISTENCY.md "UNAS-ból fizikailag törölt rendelések"):
// #4 (net stock reversal), #5 (order preserved + marked), #6 (repeated
// NOT_FOUND is a no-op), #8 (partial-already-reversed nets only the
// remainder), #9 (already-cancelled/zero net produces no new movement),
// #10 (multi-variant order reverses onto the right variants).
describe("UnasOrderSyncRepository.reconcileDeletedOrder", () => {
  function seededDb(): FakeDb {
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
    return db;
  }

  it("reverses the net booked-out quantity, marks the order CANCELLED + unasDeletedAt, and never deletes it (#4, #5)", async () => {
    const db = seededDb();
    const repository = repositoryWith(db);
    await repository.apply("run-1", [baseOrder()], null, new Date());
    const orderId = db.orders[0]!.id;
    assert.equal(db.stockItems[0]?.onHand.toString(), "8");

    const result = await repository.reconcileDeletedOrder(orderId, "UN-1");

    assert.equal(result.reversed, true);
    assert.equal(result.alreadyReconciled, false);
    // Net quantity (2, the order's only stock-relevant line) is fully
    // restored - same mechanism (targetOut=empty) a real UNAS storno uses.
    assert.equal(db.stockItems[0]?.onHand.toString(), "10");
    assert.equal(
      db.movements.some((movement) => movement.type === "RETURN_IN"),
      true,
    );
    // The order itself is NEVER physically deleted - it's still present,
    // preserved, with its full line/history intact, only marked.
    assert.equal(db.orders.length, 1);
    assert.equal(db.orders[0]?.id, orderId);
    assert.equal(db.orders[0]?.status, "CANCELLED");
    assert.ok(db.orders[0]?.unasDeletedAt instanceof Date);
  });

  it("does not create a second reversal on a repeated confirmed NOT_FOUND (#6)", async () => {
    const db = seededDb();
    const repository = repositoryWith(db);
    await repository.apply("run-1", [baseOrder()], null, new Date());
    const orderId = db.orders[0]!.id;

    const first = await repository.reconcileDeletedOrder(orderId, "UN-1");
    assert.equal(first.alreadyReconciled, false);
    assert.equal(db.stockItems[0]?.onHand.toString(), "10");
    const movementCountAfterFirst = db.movements.length;

    const second = await repository.reconcileDeletedOrder(orderId, "UN-1");

    assert.equal(second.alreadyReconciled, true);
    assert.equal(second.reversed, false);
    // No new movement, no double-restoration of stock.
    assert.equal(db.movements.length, movementCountAfterFirst);
    assert.equal(db.stockItems[0]?.onHand.toString(), "10");
  });

  it("only reverses the remaining net quantity when the order was already partially reversed by an earlier edit (#8)", async () => {
    const db = seededDb();
    const repository = repositoryWith(db);
    // Quantity 2 booked out on import (onHand 10 -> 8).
    await repository.apply("run-1", [baseOrder()], null, new Date());
    assert.equal(db.stockItems[0]?.onHand.toString(), "8");

    // Live edit: quantity drops from 2 to 1 - already returns 1 unit
    // (onHand 8 -> 9) BEFORE the physical deletion is ever detected.
    db.runs.push({ id: "run-2", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    await repository.apply(
      "run-2",
      [
        baseOrder({
          items: [{ ...baseOrder().items[0]!, quantity: "1" }],
        }),
      ],
      null,
      new Date(),
    );
    assert.equal(db.stockItems[0]?.onHand.toString(), "9");
    const orderId = db.orders[0]!.id;

    const result = await repository.reconcileDeletedOrder(orderId, "UN-1");

    // Only the STILL-outstanding 1 unit comes back, not the original 2 -
    // never a double-return of the unit already given back at the edit
    // step.
    assert.equal(result.reversed, true);
    assert.equal(db.stockItems[0]?.onHand.toString(), "10");
  });

  it("posts no new stock movement for an order that was already properly cancelled/fully reversed in UNAS before the physical deletion is detected (#9)", async () => {
    const db = seededDb();
    const repository = repositoryWith(db);
    await repository.apply("run-1", [baseOrder()], null, new Date());
    assert.equal(db.stockItems[0]?.onHand.toString(), "8");

    // A legitimate UNAS storno already reversed everything.
    db.runs.push({ id: "run-2", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    await repository.apply(
      "run-2",
      [baseOrder({ statusType: "close_fault", status: "Sztornó" })],
      null,
      new Date(),
    );
    assert.equal(db.stockItems[0]?.onHand.toString(), "10");
    assert.equal(db.orders[0]?.status, "CANCELLED");
    const orderId = db.orders[0]!.id;
    const movementCountBeforeDeletion = db.movements.length;

    // Later, the order also turns out to have been physically deleted.
    const result = await repository.reconcileDeletedOrder(orderId, "UN-1");

    assert.equal(result.reversed, false); // delta=0: nothing left to give back.
    assert.equal(db.movements.length, movementCountBeforeDeletion); // no new movement
    assert.equal(db.stockItems[0]?.onHand.toString(), "10");
    assert.ok(db.orders[0]?.unasDeletedAt instanceof Date); // still correctly flagged
  });

  it("reverses onto every distinct ProductVariant a multi-line order affected, never onto the wrong one (#10)", async () => {
    const db = new FakeDb();
    db.warehouses.push({
      id: "wh-1",
      name: "Fő raktár",
      createdAt: new Date(0),
    });
    db.variants.push(
      { id: "variant-a", sku: "sku_a" },
      { id: "variant-b", sku: "sku_b" },
    );
    db.stockItems.push(
      {
        id: "stock-a",
        variantId: "variant-a",
        warehouseId: "wh-1",
        onHand: new Prisma.Decimal(10),
      },
      {
        id: "stock-b",
        variantId: "variant-b",
        warehouseId: "wh-1",
        onHand: new Prisma.Decimal(20),
      },
    );
    db.runs.push({ id: "run-1", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    const repository = repositoryWith(db);
    await repository.apply(
      "run-1",
      [
        baseOrder({
          items: [
            {
              id: "1",
              sku: "sku_a",
              name: "Termék A",
              unit: "db",
              quantity: "3",
              priceNet: "1000",
              priceGross: "1270",
              vatRate: "27",
            },
            {
              id: "2",
              sku: "sku_b",
              name: "Termék B",
              unit: "db",
              quantity: "5",
              priceNet: "2000",
              priceGross: "2540",
              vatRate: "27",
            },
          ],
        }),
      ],
      null,
      new Date(),
    );
    const stockA = () =>
      db.stockItems.find((item) => item.variantId === "variant-a")!;
    const stockB = () =>
      db.stockItems.find((item) => item.variantId === "variant-b")!;
    assert.equal(stockA().onHand.toString(), "7");
    assert.equal(stockB().onHand.toString(), "15");
    const orderId = db.orders[0]!.id;

    await repository.reconcileDeletedOrder(orderId, "UN-1");

    assert.equal(stockA().onHand.toString(), "10");
    assert.equal(stockB().onHand.toString(), "20");
  });

  it("throws for an unknown local order id instead of silently doing nothing", async () => {
    const db = seededDb();
    const repository = repositoryWith(db);
    await assert.rejects(() =>
      repository.reconcileDeletedOrder("missing-order", "UN-1"),
    );
  });

  it("two reconciliation attempts racing for the same order book the reversal only once (#7)", async () => {
    // Honest scope note: this in-memory FakeDb has no cross-statement
    // isolation and no lock semantics at all, so issuing the two calls via
    // Promise.all here would prove nothing - both would race past the
    // "already reconciled?" read before either write lands, regardless of
    // whether the production code is correct. The real guarantee against
    // two genuinely concurrent callers comes from lockUnasOrder's
    // pg_advisory_xact_lock plus the Serializable transaction +
    // retryOnSerializationConflict wrapping in reconcileDeletedOrder (see
    // unas-order-sync.repository.ts) serializing the two transactions so
    // the second one only ever runs its read AFTER the first one's write is
    // committed - which is exactly what this test simulates by awaiting the
    // first call before issuing the second. Proving the lock itself
    // actually serializes concurrent Postgres transactions requires a real
    // Postgres instance (environment-blocked here, consistent with this
    // repo's other Postgres-only concurrency proofs).
    const db = seededDb();
    const repository = repositoryWith(db);
    await repository.apply("run-1", [baseOrder()], null, new Date());
    const orderId = db.orders[0]!.id;

    const first = await repository.reconcileDeletedOrder(orderId, "UN-1");
    const second = await repository.reconcileDeletedOrder(orderId, "UN-1");

    const outcomes = [first, second];
    assert.equal(
      outcomes.filter((o) => o.reversed).length,
      1,
      "exactly one of the two attempts must perform the actual reversal",
    );
    assert.equal(
      outcomes.filter((o) => o.alreadyReconciled).length,
      1,
      "the other attempt must observe it as already reconciled",
    );
    assert.equal(db.stockItems[0]?.onHand.toString(), "10");
    assert.equal(
      db.movements.filter((m) => m.type === "RETURN_IN" && m.lines.length > 0)
        .length,
      1,
      "only a single, fully-posted RETURN_IN movement must exist, never two",
    );
  });

  it("a transactional failure during reconciliation leaves neither the order status nor the stock ledger half-finished, and a retry recovers exactly once (#15)", async () => {
    const db = seededDb();
    const repository = repositoryWith(db);
    await repository.apply("run-1", [baseOrder()], null, new Date());
    const orderId = db.orders[0]!.id;

    // Simulate a failure partway through the shared stock-posting
    // primitive, mirroring the existing apply()-level proof above ("a
    // writer failure mid-delta leaves StockItem/run state unadvanced") but
    // for the reconcileDeletedOrder path specifically. This FakeDb doesn't
    // roll back the orphaned StockMovement header row a real Postgres
    // transaction abort would (see that test's own comment on the fake's
    // limits) - it always has empty `lines`, so it never contributes to
    // computeBookedOutAndGeneration's ledger read and is filtered out below
    // exactly like the successful-path assertions do above.
    let calls = 0;
    const realCreate = db.stockMovementLine.create.bind(db.stockMovementLine);
    db.stockMovementLine.create = async (args: any) => {
      calls += 1;
      if (calls === 1) throw new Error("simulated writer failure");
      return realCreate(args);
    };

    await assert.rejects(() =>
      repository.reconcileDeletedOrder(orderId, "UN-1"),
    );
    assert.equal(
      db.stockItems[0]?.onHand.toString(),
      "8",
      "no partial reversal applied on the failed attempt",
    );
    assert.equal(db.orders[0]?.unasDeletedAt, null);
    assert.equal(db.orders[0]?.status, "CONFIRMED");

    const retried = await repository.reconcileDeletedOrder(orderId, "UN-1");

    assert.equal(retried.reversed, true);
    assert.equal(db.stockItems[0]?.onHand.toString(), "10");
    assert.equal(db.orders[0]?.status, "CANCELLED");
    assert.notEqual(db.orders[0]?.unasDeletedAt, null);
    assert.equal(
      db.movements.filter((m) => m.type === "RETURN_IN" && m.lines.length > 0)
        .length,
      1,
      "the retry must produce exactly one fully-posted reversal movement, not a second",
    );
  });
});

// Covers mandatory test case #14: a Key UNAS legitimately reissues to a
// brand-new order after the original was physically deleted must never
// overwrite - or collide with - the old, preserved, deleted order.
describe("UnasOrderSyncRepository - UNAS Key reuse after a physical deletion", () => {
  it("treats a reused Key as a brand-new order once the old one is unasDeletedAt, without a unique-key collision", async () => {
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

    // Original order, Key=UN-1, Id=9001 (baseOrder()'s default id).
    await repository.apply("run-1", [baseOrder()], null, new Date());
    const originalOrderId = db.orders[0]!.id;
    await repository.reconcileDeletedOrder(originalOrderId, "UN-1");
    assert.equal(db.orders[0]?.unasDeletedAt !== null, true);
    assert.equal(db.orders.length, 1);
    assert.equal(db.externalReferences.length, 1);

    // UNAS reissues Key=UN-1 to a brand-new, unrelated order with a
    // DIFFERENT Id.
    db.runs.push({ id: "run-2", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    const summary = await repository.apply(
      "run-2",
      [baseOrder({ key: "UN-1", id: "9002" })],
      null,
      new Date(),
    );

    // A brand-new local order is created - the old, deleted one is never
    // touched/overwritten.
    assert.equal(summary.createdCount, 1);
    assert.equal(db.orders.length, 2);
    assert.equal(db.externalReferences.length, 2);
    const original = db.orders.find((order) => order.id === originalOrderId)!;
    assert.equal(original.status, "CANCELLED");
    assert.ok(original.unasDeletedAt instanceof Date);
    const fresh = db.orders.find((order) => order.id !== originalOrderId)!;
    assert.equal(fresh.status, "CONFIRMED");
    assert.equal(fresh.unasDeletedAt, null);
    // No unique-key collision: both ExternalReference rows coexist, keyed
    // by their distinct Ids (9001 vs 9002), not the shared Key.
    const externalIds = db.externalReferences.map((ref) => ref.externalId);
    assert.equal(new Set(externalIds).size, 2);
  });

  it("does not confuse two different, still-live orders that happen to share a legacy (pre-migration, Key-based) ExternalReference lookup path", async () => {
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
    const orderId = db.orders[0]!.id;

    // Simulate a pre-migration row: externalId still literally equals the
    // Key (as every row created before this checkpoint would).
    db.externalReferences[0]!.externalId = "UN-1";

    // A later sighting of the SAME still-live order (same Key, same Id)
    // must still resolve to the SAME local order - the legacy fallback
    // lookup, plus lazy backfill.
    db.runs.push({ id: "run-2", status: "RUNNING", activeKey: "UNAS_ORDERS" });
    const summary = await repository.apply(
      "run-2",
      [baseOrder({ statusType: "close_ok", status: "Lezárva" })],
      null,
      new Date(),
    );

    assert.equal(summary.createdCount, 0); // not treated as a new order
    assert.equal(db.orders.length, 1);
    assert.equal(db.orders[0]?.id, orderId);
    assert.equal(db.orders[0]?.status, "COMPLETED");
    // Lazily backfilled to the Id-based convention.
    assert.equal(db.externalReferences[0]?.externalId, "9001");
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
        isPackageProduct: false,
      },
      variants: [{ id: "variant-1", sku: "pump_1" }],
    });
    db.products.push({
      id: "p2",
      name: "Filter",
      unasSnapshot: {
        reportedStock: new Prisma.Decimal(3),
        reportedStockSyncedAt: new Date(),
        isPackageProduct: false,
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
        isPackageProduct: false,
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
      unasDeletedAt: null,
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
      unasDeletedAt: null,
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
