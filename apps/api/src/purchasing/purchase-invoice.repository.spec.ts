import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConflictException } from "@nestjs/common";
import { Prisma } from "@acropora/database";

import {
  PurchaseInvoiceRepository,
  type CreatePurchaseInvoiceLine,
  type CreatePurchaseInvoiceParams,
  type PurchaseInvoiceCreateTransaction,
  type PurchaseInvoiceDatabase,
} from "./purchase-invoice.repository.js";

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

/// Fake exercising PurchaseInvoiceRepository.create() end to end, including
/// the shared postInventoryMovement() primitive - this repository no longer
/// has its own StockMovement/StockItem-writing or UNAS-calling code, see
/// purchase-invoice.repository.ts. As with inventory-count.repository.spec.ts,
/// this in-memory double proves ordering (e.g. the NAV-invoice guard runs and
/// throws before any stock is touched) but not genuine cross-statement
/// Postgres rollback - that's covered at the shared-primitive level by
/// inventory-movement-writer.spec.ts, plus would need a real DB integration
/// test for full end-to-end proof (none exists yet for this flow).
class FakeDb {
  warehouseId = "wh-1";
  localProductSkuSequenceValue = 0n;
  invoices: Array<{
    id: string;
    documentNumber: string;
    supplierId: string;
    supplierInvoiceNumber: string;
  }> = [];
  invoiceDetails: any[] = [];
  stockItems: Array<{
    id: string;
    variantId: string;
    onHand: Prisma.Decimal;
    reserved?: Prisma.Decimal;
  }> = [];
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
  productExtensions: Map<
    string,
    { lastPurchaseNetPrice: Prisma.Decimal; defaultPurchaseCurrency: string }
  > = new Map();
  navIncomingInvoices: Map<string, { status: string }> = new Map();
  domainEvents: unknown[] = [];
  localProducts: Array<{
    id: string;
    name: string;
    variantId: string;
    sku: string;
    origin: "LOCAL";
    catalogAuthority: "ACROPORA";
  }> = [];

  product = {
    create: async (args: any) => {
      const sku = args.data.variants.create.sku as string;
      if (this.localProducts.some((product) => product.sku === sku)) {
        throw new Prisma.PrismaClientKnownRequestError("duplicate", {
          code: "P2002",
          clientVersion: "test",
          meta: { target: ["sku"] },
        });
      }
      const product = {
        id: nextId("product"),
        name: args.data.name as string,
        variantId: nextId("variant"),
        sku,
        origin: "LOCAL" as const,
        catalogAuthority: "ACROPORA" as const,
      };
      this.localProducts.push(product);
      return {
        id: product.id,
        name: product.name,
        origin: product.origin,
        catalogAuthority: product.catalogAuthority,
        variants: [
          {
            id: product.variantId,
            sku: product.sku,
            unit: args.data.variants.create.unit,
          },
        ],
      };
    },
  };

  purchaseInvoice = {
    // The real call always passes `include: purchaseInvoiceDetailInclude`
    // (see purchase-invoice.repository.ts's create()) - a real Prisma
    // client hydrates `supplier`/`lines[].variant.product` from that
    // include automatically. This fixture previously ignored `args.include`
    // entirely and returned a hand-picked handful of scalar fields, missing
    // `supplier` (and everything else purchase-invoice.types.ts's
    // toPurchaseInvoiceDetail/toPurchaseInvoiceSummary read) - every test
    // failed inside the mapper, before its own assertions ever ran. Since
    // `supplier` is a genuinely mandatory relation here (every
    // PurchaseInvoice has one, the include always requests it, and
    // PurchaseInvoiceSummary.supplierName is a required, non-optional
    // string), the fix is to make this fixture actually honor the include
    // contract - not to add `invoice.supplier?.name` in the mapper, which
    // would silently hide a real missing-relation bug in production too.
    create: async (args: any) => {
      const duplicate = this.invoices.find(
        (invoice) =>
          invoice.supplierId === args.data.supplierId &&
          invoice.supplierInvoiceNumber === args.data.supplierInvoiceNumber,
      );
      if (duplicate) {
        throw new Prisma.PrismaClientKnownRequestError("duplicate", {
          code: "P2002",
          clientVersion: "test",
          meta: { target: ["supplierId", "supplierInvoiceNumber"] },
        });
      }
      const id = nextId("invoice");
      const now = new Date();
      this.invoices.push({
        id,
        documentNumber: args.data.documentNumber,
        supplierId: args.data.supplierId,
        supplierInvoiceNumber: args.data.supplierInvoiceNumber,
      });
      const lineInputs: any[] = args.data.lines?.create ?? [];
      const lines = lineInputs.map((line: any) => ({
        id: line.id ?? nextId("invoice-line"),
        /// The foreign key back to the invoice. A real Prisma row always
        /// carries it, and the contract requires it; the fixture omitted it,
        /// which is invisible for as long as nothing checks the shape.
        purchaseInvoiceId: id,
        variantId: line.variantId ?? null,
        sourceDescription: line.sourceDescription ?? null,
        orderedQuantity: line.orderedQuantity,
        actualQuantity: line.actualQuantity,
        unit: line.unit,
        unitNet: line.unitNet,
        discountPercent: line.discountPercent ?? null,
        syncStatus: line.syncStatus,
        syncError: line.syncError ?? null,
        variant: line.variantId
          ? {
              sku: `sku-${line.variantId}`,
              product: { name: `Product ${line.variantId}` },
            }
          : null,
        projectReservations: [],
      }));
      const detail = {
        id,
        documentNumber: args.data.documentNumber,
        supplierInvoiceNumber: args.data.supplierInvoiceNumber,
        source: args.data.source,
        status: args.data.status,
        supplierId: args.data.supplierId,
        supplier: { name: `Supplier ${args.data.supplierId}` },
        warehouseId: args.data.warehouseId,
        currency: args.data.currency,
        exchangeRate: args.data.exchangeRate ?? null,
        invoiceDate: args.data.invoiceDate,
        dueDate: args.data.dueDate ?? null,
        isPaid: args.data.isPaid,
        paidAt: args.data.paidAt ?? null,
        vatRate: args.data.vatRate ?? null,
        note: args.data.note ?? null,
        createdAt: now,
        updatedAt: now,
        /// Who booked the invoice. Nullable in the schema, and the fixture
        /// omitted it entirely - which the contract does not allow.
        createdById: args.data.createdById ?? null,
        lines,
      };
      this.invoiceDetails.push(detail);
      return detail;
    },
    findMany: async () => [],
    findUnique: async (args: any) =>
      this.invoiceDetails.find((invoice) => invoice.id === args.where.id) ??
      null,
    count: async () => 0,
  };

  productExtension = {
    upsert: async (args: any) => {
      this.productExtensions.set(args.where.variantId, {
        lastPurchaseNetPrice: args.update.lastPurchaseNetPrice,
        defaultPurchaseCurrency: args.update.defaultPurchaseCurrency,
      });
      return {};
    },
  };

  navIncomingInvoice = {
    updateMany: async (args: any) => {
      const current = this.navIncomingInvoices.get(args.where.id);
      if (!current || current.status === "RECEIVED") return { count: 0 };
      current.status = "RECEIVED";
      return { count: 1 };
    },
  };

  domainEvent = {
    create: async (args: any) => {
      this.domainEvents.push(args.data);
      return {};
    },
  };

  project = {
    findMany: async (args: any) =>
      ((args.where?.id?.in as string[] | undefined) ?? []).map((id) => ({
        id,
      })),
  };

  projectReservations: Array<{
    id: string;
    projectId: string;
    purchaseInvoiceLineId: string;
    quantity: Prisma.Decimal;
  }> = [];

  projectInventoryReservation = {
    create: async (args: any) => {
      const reservation = {
        id: nextId("project-reservation"),
        projectId: args.data.projectId as string,
        purchaseInvoiceLineId: args.data.purchaseInvoiceLineId as string,
        quantity: args.data.quantity as Prisma.Decimal,
      };
      this.projectReservations.push(reservation);
      const line = this.invoiceDetails
        .flatMap((invoice) => invoice.lines)
        .find(
          (candidate) => candidate.id === reservation.purchaseInvoiceLineId,
        );
      line?.projectReservations.push({
        id: reservation.id,
        quantity: reservation.quantity,
        project: {
          id: reservation.projectId,
          projectNumber: "PRJ-000001",
          name: "Test project",
        },
      });
      return { id: reservation.id };
    },
  };

  stockItem = {
    findFirst: async (args: any) => {
      const item = this.stockItems.find(
        (stockItem) => stockItem.variantId === args.where.variantId,
      );
      return item
        ? {
            id: item.id,
            onHand: item.onHand,
            reserved: item.reserved ?? new Prisma.Decimal(0),
          }
        : null;
    },
    update: async (args: any) => {
      const item = this.stockItems.find((s) => s.id === args.where.id)!;
      if (args.data.onHand !== undefined) item.onHand = args.data.onHand;
      if (args.data.reserved !== undefined) item.reserved = args.data.reserved;
      return item;
    },
    create: async (args: any) => {
      const item = {
        id: nextId("stock"),
        variantId: args.data.variantId as string,
        onHand: args.data.onHand as Prisma.Decimal,
        reserved: new Prisma.Decimal(0),
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
      if (args.where.idempotencyKey) {
        const row = this.outbox.find(
          (candidate) => candidate.idempotencyKey === args.where.idempotencyKey,
        );
        if (!row) return { count: 0 };
        row.targetOnHand = args.data.targetOnHand;
        return { count: 1 };
      }
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
      /// Returns the created row's id, as the contract promises. It used to
      /// return `{}`, and the movement writer USES that id - it is how a
      /// publish whose baseline was never known gets dead-lettered.
      ///
      /// GUARDED since the transaction seam above was typed: putting `{}`
      /// back is a compile error, measured. This comment previously said the
      /// opposite, and it was true when written - a note that describes a
      /// protection which has since changed is worse than no note, so it is
      /// rewritten rather than left standing.
      const row = {
        id: nextId("outbox"),
        variantId: args.data.variantId,
        warehouseId: args.data.warehouseId,
        status: "PENDING",
        idempotencyKey: args.data.idempotencyKey,
        targetOnHand: args.data.targetOnHand,
      };
      this.outbox.push(row);
      return { id: row.id };
    },
  };

  async $executeRaw() {
    return 1;
  }

  async $queryRaw<T>() {
    this.localProductSkuSequenceValue += 1n;
    return [{ value: this.localProductSkuSequenceValue }] as unknown as T;
  }

  warehouse = {
    findFirst: async () => ({ id: this.warehouseId, name: "Fő raktár" }),
    create: async () => ({ id: this.warehouseId, name: "Fő raktár" }),
  };

  productVariant = { findMany: async () => [] };

  /// Typed, not `any`: `this` is what reaches the movement writer, so the
  /// compiler has to check it against the same contract the repository
  /// promises it.
  async $transaction<T>(
    operation: (transaction: PurchaseInvoiceCreateTransaction) => Promise<T>,
  ) {
    return operation(this);
  }
}

function repositoryWith(db: FakeDb) {
  return new PurchaseInvoiceRepository(
    db as unknown as PurchaseInvoiceDatabase,
  );
}

function baseParams(
  overrides: Partial<CreatePurchaseInvoiceParams> = {},
): CreatePurchaseInvoiceParams {
  return {
    documentNumber: "BESZ-1",
    supplierInvoiceNumber: "INV-2026-001",
    source: "EU",
    supplierId: "supplier-1",
    warehouseId: "wh-1",
    currency: "EUR",
    exchangeRate: new Prisma.Decimal("400"),
    invoiceDate: new Date("2026-07-20T00:00:00.000Z"),
    dueDate: null,
    isPaid: false,
    paidAt: null,
    vatRate: null,
    note: null,
    actorUserId: "user-1",
    lines: [
      {
        variantId: "variant-1",
        sku: "REEF-SALT-01",
        createLocalProduct: null,
        sourceDescription: null,
        orderedQuantity: new Prisma.Decimal("5"),
        actualQuantity: new Prisma.Decimal("5"),
        unit: "db",
        unitNet: new Prisma.Decimal("10"),
        discountPercent: null,
        syncStatus: "PENDING",
        syncError: null,
        syncToUnas: true,
      },
    ],
    ...overrides,
  };
}

describe("PurchaseInvoiceRepository.create", () => {
  it("books a PURCHASE_RECEIPT movement, updates StockItem, and creates exactly one outbox row for a product-linked line", async () => {
    const db = new FakeDb();
    const repository = repositoryWith(db);

    await repository.create(baseParams());

    assert.equal(db.movementLines.length, 1);
    assert.equal(db.movementLines[0]?.quantity.toString(), "5");
    assert.equal(db.stockItems.length, 1);
    assert.equal(db.stockItems[0]?.onHand.toString(), "5");
    assert.equal(db.outbox.length, 1);
    assert.equal(db.outbox[0]?.targetOnHand.toString(), "5");
    assert.equal(
      db.productExtensions.get("variant-1")?.lastPurchaseNetPrice.toString(),
      "10",
    );
  });

  it("does not create a StockMovementLine, StockItem, or outbox row for a NOT_LINKED (no product match) line", async () => {
    const db = new FakeDb();
    const repository = repositoryWith(db);

    const notLinked: CreatePurchaseInvoiceLine = {
      variantId: null,
      sku: null,
      createLocalProduct: null,
      sourceDescription: "Egyedi csomagolóanyag",
      orderedQuantity: new Prisma.Decimal("2"),
      actualQuantity: new Prisma.Decimal("2"),
      unit: "db",
      unitNet: new Prisma.Decimal("3"),
      discountPercent: null,
      syncStatus: "NOT_LINKED",
      syncError: null,
      syncToUnas: false,
    };
    await repository.create(baseParams({ lines: [notLinked] }));

    assert.equal(
      db.movements.length,
      0,
      "no stock movement at all when every line is unlinked",
    );
    assert.equal(db.movementLines.length, 0);
    assert.equal(db.stockItems.length, 0);
    assert.equal(db.outbox.length, 0);
    assert.equal(db.productExtensions.size, 0);
  });

  it("creates a LOCAL/ACROPORA product and its stock atomically without an UNAS outbox row", async () => {
    const db = new FakeDb();
    const repository = repositoryWith(db);

    await repository.create(
      baseParams({
        lines: [
          {
            variantId: null,
            sku: null,
            createLocalProduct: {
              name: "Egyedi szivattyú",
              primaryCategoryId: null,
            },
            sourceDescription: "Pump model X",
            orderedQuantity: new Prisma.Decimal("2"),
            actualQuantity: new Prisma.Decimal("2"),
            unit: "db",
            unitNet: new Prisma.Decimal("150"),
            discountPercent: null,
            syncStatus: "NOT_APPLICABLE",
            syncError: null,
            syncToUnas: false,
          },
        ],
      }),
    );

    assert.equal(db.localProducts.length, 1);
    assert.equal(db.localProducts[0]?.origin, "LOCAL");
    assert.equal(db.localProducts[0]?.catalogAuthority, "ACROPORA");
    assert.equal(db.localProducts[0]?.sku, "ACR-L-000001");
    assert.equal(db.movementLines.length, 1);
    assert.equal(db.stockItems[0]?.onHand.toString(), "2");
    assert.equal(db.outbox.length, 0);
    assert.equal(db.productExtensions.size, 1);
    assert.equal(db.domainEvents.length, 2);
  });

  it("retries automatic local SKU allocation after a collision", async () => {
    const db = new FakeDb();
    db.localProducts.push({
      id: "existing-product",
      name: "Meglévő helyi termék",
      variantId: "existing-variant",
      sku: "ACR-L-000001",
      origin: "LOCAL",
      catalogAuthority: "ACROPORA",
    });
    const repository = repositoryWith(db);

    await repository.create(
      baseParams({
        lines: [
          {
            variantId: null,
            sku: null,
            createLocalProduct: {
              name: "Másik helyi termék",
              primaryCategoryId: null,
            },
            sourceDescription: "Másik termék a számlán",
            orderedQuantity: new Prisma.Decimal("1"),
            actualQuantity: new Prisma.Decimal("1"),
            unit: "db",
            unitNet: new Prisma.Decimal("100"),
            discountPercent: null,
            syncStatus: "NOT_APPLICABLE",
            syncError: null,
            syncToUnas: false,
          },
        ],
      }),
    );

    assert.equal(db.localProducts.length, 2);
    assert.equal(db.localProducts[1]?.sku, "ACR-L-000002");
    assert.equal(db.invoices.length, 1);
    assert.equal(db.movements.length, 1);
    assert.equal(db.stockItems.length, 1);
    assert.equal(db.outbox.length, 0);
  });

  it("allocates a different automatic SKU to every local product on the same invoice", async () => {
    const db = new FakeDb();
    const repository = repositoryWith(db);
    const localLine = (
      name: string,
      quantity: string,
    ): CreatePurchaseInvoiceLine => ({
      variantId: null,
      sku: null,
      createLocalProduct: {
        name,
        primaryCategoryId: null,
      },
      sourceDescription: name,
      orderedQuantity: new Prisma.Decimal(quantity),
      actualQuantity: new Prisma.Decimal(quantity),
      unit: "db",
      unitNet: new Prisma.Decimal("100"),
      discountPercent: null,
      syncStatus: "NOT_APPLICABLE",
      syncError: null,
      syncToUnas: false,
    });

    await repository.create(
      baseParams({
        lines: [
          localLine("Első helyi termék", "1"),
          localLine("Második helyi termék", "2"),
        ],
      }),
    );

    assert.deepEqual(
      db.localProducts.map((product) => product.sku),
      ["ACR-L-000001", "ACR-L-000002"],
    );
    assert.equal(db.movementLines.length, 2);
    assert.equal(db.outbox.length, 0);
  });

  it("still books the linked line's stock effect when it's mixed with a NOT_LINKED line, skipping only the unlinked one", async () => {
    const db = new FakeDb();
    const repository = repositoryWith(db);

    const notLinked: CreatePurchaseInvoiceLine = {
      variantId: null,
      sku: null,
      createLocalProduct: null,
      sourceDescription: "Egyedi csomagolóanyag",
      orderedQuantity: new Prisma.Decimal("2"),
      actualQuantity: new Prisma.Decimal("2"),
      unit: "db",
      unitNet: new Prisma.Decimal("3"),
      discountPercent: null,
      syncStatus: "NOT_LINKED",
      syncError: null,
      syncToUnas: false,
    };
    await repository.create(
      baseParams({ lines: [...baseParams().lines, notLinked] }),
    );

    assert.equal(db.movements.length, 1);
    assert.equal(db.movementLines.length, 1);
    assert.equal(db.outbox.length, 1);
  });

  it("reserves the allocated quantity for a project and publishes only the remaining available stock", async () => {
    const db = new FakeDb();
    const repository = repositoryWith(db);

    await repository.create(
      baseParams({
        lines: [
          {
            ...baseParams().lines[0]!,
            projectAllocations: [
              {
                projectId: "project-1",
                quantity: new Prisma.Decimal("3"),
              },
            ],
          },
        ],
      }),
    );

    assert.equal(db.stockItems[0]?.onHand.toString(), "5");
    assert.equal(db.stockItems[0]?.reserved?.toString(), "3");
    assert.equal(db.projectReservations.length, 1);
    assert.equal(db.projectReservations[0]?.projectId, "project-1");
    assert.equal(db.projectReservations[0]?.quantity.toString(), "3");
    assert.equal(db.outbox[0]?.targetOnHand.toString(), "2");
  });

  it("aggregates two invoice lines for the same variant into one physical movement without losing quantity", async () => {
    const db = new FakeDb();
    const repository = repositoryWith(db);

    await repository.create(
      baseParams({
        lines: [
          {
            variantId: "variant-1",
            sku: "REEF-SALT-01",
            createLocalProduct: null,
            sourceDescription: null,
            orderedQuantity: new Prisma.Decimal("5"),
            actualQuantity: new Prisma.Decimal("5"),
            unit: "db",
            unitNet: new Prisma.Decimal("10"),
            discountPercent: null,
            syncStatus: "PENDING",
            syncError: null,
            syncToUnas: true,
          },
          {
            variantId: "variant-1",
            sku: "REEF-SALT-01",
            createLocalProduct: null,
            sourceDescription: null,
            orderedQuantity: new Prisma.Decimal("3"),
            actualQuantity: new Prisma.Decimal("3"),
            unit: "db",
            unitNet: new Prisma.Decimal("12"),
            discountPercent: null,
            syncStatus: "PENDING",
            syncError: null,
            syncToUnas: true,
          },
        ],
      }),
    );

    // The invoice keeps both commercial lines (and their separate prices),
    // while the physical ledger receives one summed delta for the variant.
    assert.equal(db.movementLines.length, 1);
    assert.equal(db.movementLines[0]?.quantity.toString(), "8");
    assert.equal(db.stockItems.length, 1);
    assert.equal(db.stockItems[0]?.onHand.toString(), "8");
    /// The row is written but NOT publishable, and that changed here for a
    /// reason worth recording.
    ///
    /// This fixture has no StockItem for the variant, so the receipt starts
    /// from a baseline nobody knew, and #306 dead-letters the publish rather
    /// than setting the shop's stock to the received amount alone. The
    /// assertion below used to expect a PENDING row, and it passed only
    /// because this double's `create` returned `{}`: the writer then had no
    /// id to close the row with, and the dead-lettering silently did nothing.
    ///
    /// So the broken double was hiding a guard that was already merged. With
    /// the double honest, this test now covers #306 from the purchase side.
    assert.equal(db.outbox.length, 1);
    assert.equal(db.outbox[0]?.status, "DEAD_LETTER");
    assert.equal(db.outbox[0]?.targetOnHand.toString(), "8");
    assert.equal(
      db.outbox.filter((row) => row.status === "PENDING").length,
      0,
      "a baseline nobody knew must not be published to the shop",
    );
    // The second (later) line's price wins the last-purchase-price upsert.
    assert.equal(
      db.productExtensions.get("variant-1")?.lastPurchaseNetPrice.toString(),
      "12",
    );
  });

  it("rejects re-posting the same (supplierId, supplierInvoiceNumber) with a clear conflict instead of double-booking stock", async () => {
    const db = new FakeDb();
    const repository = repositoryWith(db);

    await repository.create(baseParams({ documentNumber: "BESZ-1" }));
    assert.equal(db.movements.length, 1);
    assert.equal(db.stockItems[0]?.onHand.toString(), "5");

    // A retried request generates a fresh documentNumber (see
    // PurchasingService.createInvoice) but the same supplierId +
    // supplierInvoiceNumber - the DB's own unique constraint on
    // PurchaseInvoice is what actually stops it, before postInventoryMovement
    // even runs.
    await assert.rejects(
      () => repository.create(baseParams({ documentNumber: "BESZ-2" })),
      ConflictException,
    );

    assert.equal(
      db.movements.length,
      1,
      "no second stock movement was created",
    );
    assert.equal(db.stockItems.length, 1);
    assert.equal(
      db.stockItems[0]?.onHand.toString(),
      "5",
      "stock was not double-booked",
    );
    assert.equal(db.outbox.length, 1);
  });

  it("throws (and books nothing) when the linked NAV incoming invoice was already received - the guard runs before any stock is touched", async () => {
    const db = new FakeDb();
    db.navIncomingInvoices.set("nav-1", { status: "RECEIVED" });
    const repository = repositoryWith(db);

    await assert.rejects(
      () =>
        repository.create(
          baseParams({
            navIncomingInvoiceId: "nav-1",
            source: "HU_NAV",
            currency: "HUF",
            vatRate: new Prisma.Decimal("27"),
          }),
        ),
      ConflictException,
    );

    assert.equal(db.movements.length, 0);
    assert.equal(db.stockItems.length, 0);
    assert.equal(db.outbox.length, 0);
  });

  it("links the NAV incoming invoice and books stock together when it hasn't been received yet", async () => {
    const db = new FakeDb();
    db.navIncomingInvoices.set("nav-1", { status: "PENDING" });
    const repository = repositoryWith(db);

    await repository.create(
      baseParams({
        navIncomingInvoiceId: "nav-1",
        source: "HU_NAV",
        currency: "HUF",
        vatRate: new Prisma.Decimal("27"),
      }),
    );

    assert.equal(db.navIncomingInvoices.get("nav-1")?.status, "RECEIVED");
    assert.equal(db.movements.length, 1);
    assert.equal(db.stockItems.length, 1);
  });

  it("records exactly one domain event per posted invoice regardless of line count", async () => {
    const db = new FakeDb();
    const repository = repositoryWith(db);

    await repository.create(
      baseParams({
        lines: [
          ...baseParams().lines,
          {
            variantId: "variant-2",
            sku: "PUMP-XL",
            createLocalProduct: null,
            sourceDescription: null,
            orderedQuantity: new Prisma.Decimal("1"),
            actualQuantity: new Prisma.Decimal("1"),
            unit: "db",
            unitNet: new Prisma.Decimal("20"),
            discountPercent: null,
            syncStatus: "PENDING",
            syncError: null,
            syncToUnas: true,
          },
        ],
      }),
    );

    assert.equal(db.domainEvents.length, 1);
  });
});
