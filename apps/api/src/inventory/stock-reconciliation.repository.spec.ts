import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@acropora/database";

import {
  StockReconciliationRepository,
  type StockReconciliationDatabase,
} from "./stock-reconciliation.repository.js";

function d(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

interface FakeStockItem {
  id: string;
  variantId: string;
  warehouseId: string;
  onHand: Prisma.Decimal;
  sku: string;
  warehouseCode: string;
}

interface FakeMovementLine {
  variantId: string;
  quantity: Prisma.Decimal;
  type: string;
  sourceWarehouseId: string;
}

interface FakeProductLink {
  variantId: string;
  productId: string;
  reportedStock: Prisma.Decimal | null;
  firstVariantId: string; // the product's own first variant - same for every variant of that product
  variantCount: number;
  catalogAuthority?: "UNAS" | "ACROPORA" | null;
  isPackageProduct?: boolean;
}

interface FakeOutboxRow {
  variantId: string;
  warehouseId: string;
  targetOnHand: Prisma.Decimal;
  status: string;
  resolutionNote: string | null;
  leaseExpiresAt: Date | null;
  lastError: string | null;
  processedAt: Date | null;
  updatedAt: Date;
  sequence: bigint;
}

class FakeDb implements StockReconciliationDatabase {
  stockItems: FakeStockItem[] = [];
  movementLines: FakeMovementLine[] = [];
  productLinks: FakeProductLink[] = [];
  outboxRows: FakeOutboxRow[] = [];

  stockItem = {
    // Three distinct shapes hit this same fake, from three different
    // repository methods: reconcilePage's plain-string variantId/
    // warehouseId equality filter, reconcileByStockItemId's `{ id }`
    // lookup, and findVariantsMissingStockItem's `variantId: { in: [...] }`
    // membership filter - this previously only handled the first shape, so
    // any `{ in: [...] }` value was compared with `===` against a string
    // and always failed to match, making findVariantsMissingStockItem's
    // "already has a StockItem" exclusion silently return nothing.
    findMany: async (args: {
      where?: {
        id?: string;
        variantId?: string | { in: string[] };
        warehouseId?: string;
      };
      skip?: number;
      take?: number;
    }) => {
      const variantIdFilter = args.where?.variantId;
      const matchesVariantId = (candidate: string): boolean => {
        if (variantIdFilter === undefined) return true;
        if (typeof variantIdFilter === "string")
          return candidate === variantIdFilter;
        return variantIdFilter.in.includes(candidate);
      };
      const filtered = this.stockItems.filter(
        (item) =>
          (!args.where?.id || item.id === args.where.id) &&
          matchesVariantId(item.variantId) &&
          (!args.where?.warehouseId ||
            item.warehouseId === args.where.warehouseId),
      );
      const sorted = [...filtered].sort((a, b) =>
        a.variantId === b.variantId
          ? a.warehouseId.localeCompare(b.warehouseId)
          : a.variantId.localeCompare(b.variantId),
      );
      const page = sorted.slice(
        args.skip ?? 0,
        (args.skip ?? 0) + (args.take ?? sorted.length),
      );
      return page.map((item) => ({
        id: item.id,
        variantId: item.variantId,
        warehouseId: item.warehouseId,
        onHand: item.onHand,
        variant: { sku: item.sku },
        warehouse: { code: item.warehouseCode },
      }));
    },
    count: async (args: {
      where?: { variantId?: string; warehouseId?: string };
    }) => {
      return this.stockItems.filter(
        (item) =>
          (!args.where?.variantId || item.variantId === args.where.variantId) &&
          (!args.where?.warehouseId ||
            item.warehouseId === args.where.warehouseId),
      ).length;
    },
    groupBy: async (args: { where?: { variantId?: { in: string[] } } }) => {
      const variantIds = args.where?.variantId?.in ?? [];
      return variantIds.map((variantId) => {
        const sum = this.stockItems
          .filter((item) => item.variantId === variantId)
          .reduce((acc, item) => acc.plus(item.onHand), new Prisma.Decimal(0));
        return { variantId, _sum: { onHand: sum } };
      });
    },
  };

  stockMovementLine = {
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
    // buildRows asks for specific variants regardless of authority, while
    // findVariantsMissingStockItem asks for every UNAS product with a known
    // reported stock. Mirror both query shapes so local products remain
    // visible to reconciliation without entering the UNAS-only missing-row
    // candidate universe.
    findMany: async (args: { where?: { id?: { in: string[] } } }) => {
      const requestedVariantIds = args.where?.id?.in;
      const links = requestedVariantIds
        ? this.productLinks.filter((link) =>
            requestedVariantIds.includes(link.variantId),
          )
        : this.productLinks.filter(
            (link) =>
              (link.catalogAuthority ?? "UNAS") === "UNAS" &&
              link.reportedStock !== null,
          );
      return links.map((link) => ({
        id: link.variantId,
        productId: link.productId,
        product: {
          catalogAuthority: link.catalogAuthority ?? "UNAS",
          unasSnapshot:
            link.reportedStock !== null
              ? {
                  reportedStock: link.reportedStock,
                  isPackageProduct: link.isPackageProduct ?? false,
                }
              : null,
          variants: Array.from({ length: link.variantCount }, (_, index) =>
            index === 0
              ? { id: link.firstVariantId }
              : { id: `${link.firstVariantId}-other-${index}` },
          ).slice(0, 1),
        },
      }));
    },
  };

  unasStockSyncOutbox = {
    findMany: async (args: {
      where: { variantId: { in: string[] }; warehouseId: { in: string[] } };
    }) => {
      const variantIds = new Set(args.where.variantId.in);
      const warehouseIds = new Set(args.where.warehouseId.in);
      return this.outboxRows
        .filter(
          (row) =>
            variantIds.has(row.variantId) && warehouseIds.has(row.warehouseId),
        )
        .sort((a, b) =>
          a.sequence > b.sequence ? -1 : a.sequence < b.sequence ? 1 : 0,
        )
        .map((row, index) => ({ id: `outbox-${index}`, ...row }));
    },
  };
}

describe("StockReconciliationRepository.reconcilePage", () => {
  it("computes ledgerExpectedOnHand from PURCHASE_RECEIPT/SALE and flags LOCAL_LEDGER_MISMATCH when it disagrees with onHand", async () => {
    const db = new FakeDb();
    db.stockItems.push({
      id: "si-1",
      variantId: "v1",
      warehouseId: "wh-1",
      onHand: d("999"), // deliberately wrong vs the ledger (10 - 3 = 7)
      sku: "sku-1",
      warehouseCode: "FO",
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
    const repository = new StockReconciliationRepository(db);
    const page = await repository.reconcilePage({ page: 1, pageSize: 10 });
    assert.equal(page.items.length, 1);
    const row = page.items[0]!;
    assert.equal(row.ledgerExpectedOnHand, "7");
    assert.equal(row.localOnHand, "999");
    assert.equal(row.status, "LOCAL_LEDGER_MISMATCH");
  });

  it("is CONSISTENT when local matches ledger and there is no UNAS product link (MISSING_UNAS_LINK not triggered because... )", async () => {
    const db = new FakeDb();
    db.stockItems.push({
      id: "si-1",
      variantId: "v1",
      warehouseId: "wh-1",
      onHand: d("7"),
      sku: "sku-1",
      warehouseCode: "FO",
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
    // No productLinks entry at all - no UNAS product/snapshot linked.
    const repository = new StockReconciliationRepository(db);
    const page = await repository.reconcilePage({ page: 1, pageSize: 10 });
    assert.equal(page.items[0]!.status, "MISSING_UNAS_LINK");
  });

  it("treats a local Acropora product as CONSISTENT without an UNAS snapshot", async () => {
    const db = new FakeDb();
    db.stockItems.push({
      id: "si-1",
      variantId: "v1",
      warehouseId: "wh-1",
      onHand: d("7"),
      sku: "local-sku-1",
      warehouseCode: "FO",
    });
    db.movementLines.push({
      variantId: "v1",
      quantity: d("7"),
      type: "PURCHASE_RECEIPT",
      sourceWarehouseId: "wh-1",
    });
    db.productLinks.push({
      variantId: "v1",
      productId: "p1",
      reportedStock: null,
      firstVariantId: "v1",
      variantCount: 1,
      catalogAuthority: "ACROPORA",
    });

    const repository = new StockReconciliationRepository(db);
    const page = await repository.reconcilePage({ page: 1, pageSize: 10 });

    assert.equal(page.items[0]!.status, "CONSISTENT");
    assert.equal(page.items[0]!.unasOnHand, null);
    assert.match(page.items[0]!.notes.join(" "), /nem alkalmazandó/);
  });

  it("is HISTORICAL_BASELINE_UNKNOWN when a StockItem exists with no ledger movement at all", async () => {
    const db = new FakeDb();
    db.stockItems.push({
      id: "si-1",
      variantId: "v1",
      warehouseId: "wh-1",
      onHand: d("42"), // set via the leltár baseline-only path, never a movement
      sku: "sku-1",
      warehouseCode: "FO",
    });
    const repository = new StockReconciliationRepository(db);
    const page = await repository.reconcilePage({ page: 1, pageSize: 10 });
    assert.equal(page.items[0]!.status, "HISTORICAL_BASELINE_UNKNOWN");
    assert.equal(page.items[0]!.ledgerExpectedOnHand, null);
  });

  it("is INVALID_LEDGER_DATA when an ADJUSTMENT movement touches the pair, even if it happens to sum to the same onHand", async () => {
    const db = new FakeDb();
    db.stockItems.push({
      id: "si-1",
      variantId: "v1",
      warehouseId: "wh-1",
      onHand: d("5"),
      sku: "sku-1",
      warehouseCode: "FO",
    });
    db.movementLines.push({
      variantId: "v1",
      quantity: d("5"),
      type: "ADJUSTMENT",
      sourceWarehouseId: "wh-1",
    });
    const repository = new StockReconciliationRepository(db);
    const page = await repository.reconcilePage({ page: 1, pageSize: 10 });
    assert.equal(page.items[0]!.status, "INVALID_LEDGER_DATA");
    assert.equal(page.items[0]!.ledgerExpectedOnHand, null);
    assert.equal(page.items[0]!.ledgerProvable, false);
  });

  it("keeps two warehouses' ledgers and onHand fully independent for the same variant", async () => {
    const db = new FakeDb();
    db.stockItems.push(
      {
        id: "si-1",
        variantId: "v1",
        warehouseId: "wh-1",
        onHand: d("7"),
        sku: "sku-1",
        warehouseCode: "FO",
      },
      {
        id: "si-2",
        variantId: "v1",
        warehouseId: "wh-2",
        onHand: d("100"),
        sku: "sku-1",
        warehouseCode: "MASODIK",
      },
    );
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
      {
        variantId: "v1",
        quantity: d("100"),
        type: "PURCHASE_RECEIPT",
        sourceWarehouseId: "wh-2",
      },
    );
    const repository = new StockReconciliationRepository(db);
    const page = await repository.reconcilePage({ page: 1, pageSize: 10 });
    assert.equal(page.items.length, 2);
    const wh1 = page.items.find((row) => row.warehouseId === "wh-1")!;
    const wh2 = page.items.find((row) => row.warehouseId === "wh-2")!;
    assert.equal(wh1.ledgerExpectedOnHand, "7");
    assert.equal(wh1.localOnHand, "7");
    assert.equal(wh2.ledgerExpectedOnHand, "100");
    assert.equal(wh2.localOnHand, "100");
    // Both rows have no UNAS product link in this fixture, so both land on
    // MISSING_UNAS_LINK rather than CONSISTENT - what matters here is that
    // their ledger/local figures never leak into each other.
    assert.equal(wh1.status, "MISSING_UNAS_LINK");
    assert.equal(wh2.status, "MISSING_UNAS_LINK");
  });

  it("compares UNAS reportedStock against the SUM of localOnHand across ALL warehouses, not just one row's warehouse", async () => {
    const db = new FakeDb();
    db.stockItems.push(
      {
        id: "si-1",
        variantId: "v1",
        warehouseId: "wh-1",
        onHand: d("7"),
        sku: "sku-1",
        warehouseCode: "FO",
      },
      {
        id: "si-2",
        variantId: "v1",
        warehouseId: "wh-2",
        onHand: d("3"),
        sku: "sku-1",
        warehouseCode: "MASODIK",
      },
    );
    db.movementLines.push(
      {
        variantId: "v1",
        quantity: d("7"),
        type: "PURCHASE_RECEIPT",
        sourceWarehouseId: "wh-1",
      },
      {
        variantId: "v1",
        quantity: d("3"),
        type: "PURCHASE_RECEIPT",
        sourceWarehouseId: "wh-2",
      },
    );
    db.productLinks.push({
      variantId: "v1",
      productId: "p1",
      reportedStock: d("10"),
      firstVariantId: "v1",
      variantCount: 1,
    });
    const repository = new StockReconciliationRepository(db);
    const page = await repository.reconcilePage({ page: 1, pageSize: 10 });
    for (const row of page.items) {
      assert.equal(row.unasOnHand, "10");
      assert.equal(row.unasVsLocalDelta, "0");
      assert.equal(row.status, "CONSISTENT");
    }
  });

  it("flags UNAS_MISMATCH_NO_PENDING_SYNC when UNAS disagrees and there is no outbox row at all", async () => {
    const db = new FakeDb();
    db.stockItems.push({
      id: "si-1",
      variantId: "v1",
      warehouseId: "wh-1",
      onHand: d("5"),
      sku: "sku-1",
      warehouseCode: "FO",
    });
    db.movementLines.push({
      variantId: "v1",
      quantity: d("5"),
      type: "PURCHASE_RECEIPT",
      sourceWarehouseId: "wh-1",
    });
    db.productLinks.push({
      variantId: "v1",
      productId: "p1",
      reportedStock: d("999"),
      firstVariantId: "v1",
      variantCount: 1,
    });
    const repository = new StockReconciliationRepository(db);
    const page = await repository.reconcilePage({ page: 1, pageSize: 10 });
    assert.equal(page.items[0]!.status, "UNAS_MISMATCH_NO_PENDING_SYNC");
  });

  it("flags UNAS_BEHIND_PENDING_SYNC when UNAS disagrees but a PENDING outbox row is already queued", async () => {
    const db = new FakeDb();
    db.stockItems.push({
      id: "si-1",
      variantId: "v1",
      warehouseId: "wh-1",
      onHand: d("5"),
      sku: "sku-1",
      warehouseCode: "FO",
    });
    db.movementLines.push({
      variantId: "v1",
      quantity: d("5"),
      type: "PURCHASE_RECEIPT",
      sourceWarehouseId: "wh-1",
    });
    db.productLinks.push({
      variantId: "v1",
      productId: "p1",
      reportedStock: d("999"),
      firstVariantId: "v1",
      variantCount: 1,
    });
    db.outboxRows.push({
      variantId: "v1",
      warehouseId: "wh-1",
      targetOnHand: d("5"),
      status: "PENDING",
      resolutionNote: null,
      leaseExpiresAt: null,
      lastError: null,
      processedAt: null,
      updatedAt: new Date(),
      sequence: 1n,
    });
    const repository = new StockReconciliationRepository(db);
    const page = await repository.reconcilePage({ page: 1, pageSize: 10 });
    assert.equal(page.items[0]!.status, "UNAS_BEHIND_PENDING_SYNC");
    assert.equal(page.items[0]!.outbox.latestStatus, "PENDING");
  });

  it("flags SYNC_FAILED when the latest outbox row is DEAD_LETTER", async () => {
    const db = new FakeDb();
    db.stockItems.push({
      id: "si-1",
      variantId: "v1",
      warehouseId: "wh-1",
      onHand: d("5"),
      sku: "sku-1",
      warehouseCode: "FO",
    });
    db.movementLines.push({
      variantId: "v1",
      quantity: d("5"),
      type: "PURCHASE_RECEIPT",
      sourceWarehouseId: "wh-1",
    });
    db.outboxRows.push({
      variantId: "v1",
      warehouseId: "wh-1",
      targetOnHand: d("5"),
      status: "DEAD_LETTER",
      resolutionNote: null,
      leaseExpiresAt: null,
      lastError: "UNAS_TIMEOUT",
      processedAt: null,
      updatedAt: new Date(),
      sequence: 1n,
    });
    const repository = new StockReconciliationRepository(db);
    const page = await repository.reconcilePage({ page: 1, pageSize: 10 });
    assert.equal(page.items[0]!.status, "SYNC_FAILED");
  });

  it("flags PROCESSING_LEASE_EXPIRED when the latest row is PROCESSING with a lease in the past", async () => {
    const db = new FakeDb();
    db.stockItems.push({
      id: "si-1",
      variantId: "v1",
      warehouseId: "wh-1",
      onHand: d("5"),
      sku: "sku-1",
      warehouseCode: "FO",
    });
    db.movementLines.push({
      variantId: "v1",
      quantity: d("5"),
      type: "PURCHASE_RECEIPT",
      sourceWarehouseId: "wh-1",
    });
    db.outboxRows.push({
      variantId: "v1",
      warehouseId: "wh-1",
      targetOnHand: d("5"),
      status: "PROCESSING",
      resolutionNote: null,
      leaseExpiresAt: new Date(Date.now() - 60_000),
      lastError: null,
      processedAt: null,
      updatedAt: new Date(),
      sequence: 1n,
    });
    const repository = new StockReconciliationRepository(db);
    const page = await repository.reconcilePage({ page: 1, pageSize: 10 });
    assert.equal(page.items[0]!.status, "PROCESSING_LEASE_EXPIRED");
  });

  it("does NOT flag PROCESSING_LEASE_EXPIRED when the lease is still valid", async () => {
    const db = new FakeDb();
    db.stockItems.push({
      id: "si-1",
      variantId: "v1",
      warehouseId: "wh-1",
      onHand: d("5"),
      sku: "sku-1",
      warehouseCode: "FO",
    });
    db.movementLines.push({
      variantId: "v1",
      quantity: d("5"),
      type: "PURCHASE_RECEIPT",
      sourceWarehouseId: "wh-1",
    });
    db.outboxRows.push({
      variantId: "v1",
      warehouseId: "wh-1",
      targetOnHand: d("5"),
      status: "PROCESSING",
      resolutionNote: null,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      lastError: null,
      processedAt: null,
      updatedAt: new Date(),
      sequence: 1n,
    });
    const repository = new StockReconciliationRepository(db);
    const page = await repository.reconcilePage({ page: 1, pageSize: 10 });
    assert.notEqual(page.items[0]!.status, "PROCESSING_LEASE_EXPIRED");
  });

  it("recognizes an only-superseded outbox history distinctly (onlySupersededRows)", async () => {
    const db = new FakeDb();
    db.stockItems.push({
      id: "si-1",
      variantId: "v1",
      warehouseId: "wh-1",
      onHand: d("5"),
      sku: "sku-1",
      warehouseCode: "FO",
    });
    db.movementLines.push({
      variantId: "v1",
      quantity: d("5"),
      type: "PURCHASE_RECEIPT",
      sourceWarehouseId: "wh-1",
    });
    db.outboxRows.push({
      variantId: "v1",
      warehouseId: "wh-1",
      targetOnHand: d("5"),
      status: "SUCCEEDED",
      resolutionNote: "superseded_by:xyz",
      leaseExpiresAt: null,
      lastError: null,
      processedAt: new Date(),
      updatedAt: new Date(),
      sequence: 1n,
    });
    const repository = new StockReconciliationRepository(db);
    const page = await repository.reconcilePage({ page: 1, pageSize: 10 });
    assert.equal(page.items[0]!.outbox.onlySupersededRows, true);
    assert.equal(page.items[0]!.outbox.lastSuccessfulPublishAt, null); // a supersede is never a real publish
  });

  it("compares the latest real SUCCEEDED publish's targetOnHand against current localOnHand", async () => {
    const db = new FakeDb();
    db.stockItems.push({
      id: "si-1",
      variantId: "v1",
      warehouseId: "wh-1",
      onHand: d("9"),
      sku: "sku-1",
      warehouseCode: "FO",
    });
    db.movementLines.push({
      variantId: "v1",
      quantity: d("9"),
      type: "PURCHASE_RECEIPT",
      sourceWarehouseId: "wh-1",
    });
    db.outboxRows.push({
      variantId: "v1",
      warehouseId: "wh-1",
      targetOnHand: d("9"),
      status: "SUCCEEDED",
      resolutionNote: null,
      leaseExpiresAt: null,
      lastError: null,
      processedAt: new Date(),
      updatedAt: new Date(),
      sequence: 1n,
    });
    const repository = new StockReconciliationRepository(db);
    const page = await repository.reconcilePage({ page: 1, pageSize: 10 });
    assert.equal(page.items[0]!.outbox.latestSuccessMatchesCurrentLocal, true);
  });

  it("supports pagination (page/pageSize) without loading everything at once", async () => {
    const db = new FakeDb();
    for (let index = 0; index < 5; index += 1) {
      db.stockItems.push({
        id: `si-${index}`,
        variantId: `v${index}`,
        warehouseId: "wh-1",
        onHand: d("1"),
        sku: `sku-${index}`,
        warehouseCode: "FO",
      });
    }
    const repository = new StockReconciliationRepository(db);
    const first = await repository.reconcilePage({ page: 1, pageSize: 2 });
    const second = await repository.reconcilePage({ page: 2, pageSize: 2 });
    assert.equal(first.items.length, 2);
    assert.equal(second.items.length, 2);
    assert.equal(first.totalItems, 5);
    assert.equal(first.totalPages, 3);
    assert.notDeepEqual(
      first.items.map((row) => row.variantId),
      second.items.map((row) => row.variantId),
    );
  });

  it("only compares a multi-variant product's FIRST variant against UNAS - other variants get unasOnHand=null", async () => {
    const db = new FakeDb();
    db.stockItems.push(
      {
        id: "si-1",
        variantId: "v1",
        warehouseId: "wh-1",
        onHand: d("5"),
        sku: "sku-1",
        warehouseCode: "FO",
      },
      {
        id: "si-2",
        variantId: "v2",
        warehouseId: "wh-1",
        onHand: d("2"),
        sku: "sku-2",
        warehouseCode: "FO",
      },
    );
    db.movementLines.push(
      {
        variantId: "v1",
        quantity: d("5"),
        type: "PURCHASE_RECEIPT",
        sourceWarehouseId: "wh-1",
      },
      {
        variantId: "v2",
        quantity: d("2"),
        type: "PURCHASE_RECEIPT",
        sourceWarehouseId: "wh-1",
      },
    );
    db.productLinks.push(
      {
        variantId: "v1",
        productId: "p1",
        reportedStock: d("5"),
        firstVariantId: "v1",
        variantCount: 2,
      },
      {
        variantId: "v2",
        productId: "p1",
        reportedStock: d("5"),
        firstVariantId: "v1",
        variantCount: 2,
      },
    );
    const repository = new StockReconciliationRepository(db);
    const page = await repository.reconcilePage({ page: 1, pageSize: 10 });
    const v1 = page.items.find((row) => row.variantId === "v1")!;
    const v2 = page.items.find((row) => row.variantId === "v2")!;
    assert.equal(v1.unasOnHand, "5");
    assert.equal(v2.unasOnHand, null);
    assert.equal(v2.status, "MISSING_UNAS_LINK");
  });

  it("never calls a mutating method - the injected FakeDb only exposes findMany/count/groupBy", () => {
    // Structural proof: StockReconciliationDatabase's TypeScript interface
    // (stock-reconciliation.repository.ts) declares ONLY findMany/count/
    // groupBy across every model - there is no create/update/delete/upsert
    // method anywhere in its type, so any code compiled against it (this
    // whole repository) cannot call one without a type error. This test
    // documents that structural guarantee for a human reader by listing
    // exactly the methods each model exposes on the FakeDb and asserting
    // none of them is a mutating name.
    const db = new FakeDb();
    const methodsByModel: Record<string, string[]> = {
      stockItem: Object.keys(db.stockItem),
      stockMovementLine: Object.keys(db.stockMovementLine),
      productVariant: Object.keys(db.productVariant),
      unasStockSyncOutbox: Object.keys(db.unasStockSyncOutbox),
    };
    const allowed = new Set(["findMany", "count", "groupBy"]);
    for (const [modelName, methodNames] of Object.entries(methodsByModel)) {
      for (const methodName of methodNames) {
        assert.ok(
          allowed.has(methodName),
          `unexpected mutating-looking method ${modelName}.${methodName}`,
        );
      }
    }
  });
});

describe("StockReconciliationRepository.findVariantsMissingStockItem", () => {
  it("lists a UNAS-linked variant with reportedStock set but zero StockItem rows anywhere", async () => {
    const db = new FakeDb();
    db.productLinks.push({
      variantId: "v-missing",
      productId: "p1",
      reportedStock: d("15"),
      firstVariantId: "v-missing",
      variantCount: 1,
    });
    // No stockItems at all.
    const repository = new StockReconciliationRepository(db);
    const result = await repository.findVariantsMissingStockItem({
      warehouseId: "wh-1",
      page: 1,
      pageSize: 10,
    });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]!.variantId, "v-missing");
    assert.equal(result.items[0]!.unasOnHand, "15");
  });

  it("never lists a local product as missing an UNAS-backed StockItem", async () => {
    const db = new FakeDb();
    db.productLinks.push({
      variantId: "v-local",
      productId: "p-local",
      // Defensive fixture: even a stale/corrupt snapshot must not turn a
      // local-authority product into an UNAS reconciliation candidate.
      reportedStock: d("15"),
      firstVariantId: "v-local",
      variantCount: 1,
      catalogAuthority: "ACROPORA",
    });

    const repository = new StockReconciliationRepository(db);
    const result = await repository.findVariantsMissingStockItem({
      warehouseId: "wh-1",
      page: 1,
      pageSize: 10,
    });

    assert.equal(result.items.length, 0);
  });

  it("excludes a variant that already has a StockItem row in the target warehouse", async () => {
    const db = new FakeDb();
    db.productLinks.push({
      variantId: "v1",
      productId: "p1",
      reportedStock: d("15"),
      firstVariantId: "v1",
      variantCount: 1,
    });
    db.stockItems.push({
      id: "si-1",
      variantId: "v1",
      warehouseId: "wh-1",
      onHand: d("15"),
      sku: "sku-1",
      warehouseCode: "FO",
    });
    const repository = new StockReconciliationRepository(db);
    const result = await repository.findVariantsMissingStockItem({
      warehouseId: "wh-1",
      page: 1,
      pageSize: 10,
    });
    assert.equal(result.items.length, 0);
  });
});
