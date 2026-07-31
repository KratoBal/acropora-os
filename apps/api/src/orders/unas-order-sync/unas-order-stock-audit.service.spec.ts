import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@acropora/database";

import {
  UnasOrderStockAuditRepository,
  type UnasOrderStockAuditDatabase,
} from "./unas-order-stock-audit.repository.js";
import { UnasOrderStockAuditService } from "./unas-order-stock-audit.service.js";

function d(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

class FakeAuditDb implements UnasOrderStockAuditDatabase {
  orders: Array<{
    id: string;
    orderNumber: string;
    status: string;
    lines: Array<{ variantId: string | null; quantity: Prisma.Decimal }>;
  }> = [];
  references: Array<{ entityId: string; externalId: string }> = [];
  movements: Array<{
    referenceId: string | null;
    type: string;
    lines: Array<{ variantId: string; quantity: Prisma.Decimal }>;
  }> = [];
  variants: Array<{
    id: string;
    sku: string;
    isPackageProduct?: boolean;
    packageComponents?: Array<{ sku: string; qty: string }>;
  }> = [];

  productVariant = {
    findMany: async (args: any) => {
      const ids: string[] | undefined = args.where?.id?.in;
      const skus: string[] | undefined = args.where?.sku?.in;
      return this.variants
        .filter(
          (variant) =>
            (!ids || ids.includes(variant.id)) &&
            (!skus || skus.includes(variant.sku)),
        )
        .map((variant) => ({
          id: variant.id,
          sku: variant.sku,
          product: {
            catalogAuthority: "UNAS" as const,
            unasSnapshot: {
              isPackageProduct: variant.isPackageProduct ?? false,
              packageComponents: variant.packageComponents ?? [],
            },
          },
        }));
    },
  };

  salesOrder = {
    findMany: async (args: { skip?: number; take?: number }) => {
      const sorted = [...this.orders].sort((a, b) => a.id.localeCompare(b.id));
      return sorted.slice(
        args.skip ?? 0,
        (args.skip ?? 0) + (args.take ?? sorted.length),
      );
    },
    count: async () => this.orders.length,
  };

  externalReference = {
    findMany: async (args: {
      where: { entityId?: { in: string[] }; externalId?: { in: string[] } };
    }) => {
      let filtered = this.references;
      if (args.where.entityId) {
        const ids = new Set(args.where.entityId.in);
        filtered = filtered.filter((row) => ids.has(row.entityId));
      }
      if (args.where.externalId) {
        const keys = new Set(args.where.externalId.in);
        filtered = filtered.filter((row) => keys.has(row.externalId));
      }
      return filtered;
    },
    groupBy: async () => {
      const counts = new Map<string, number>();
      for (const row of this.references) {
        counts.set(row.externalId, (counts.get(row.externalId) ?? 0) + 1);
      }
      return [...counts.entries()].map(([externalId, count]) => ({
        externalId,
        _count: { externalId: count },
      }));
    },
  };

  stockMovement = {
    findMany: async (args: { where: { referenceId?: { in: string[] } } }) => {
      let filtered = this.movements;
      if (args.where.referenceId) {
        const ids = new Set(args.where.referenceId.in);
        filtered = filtered.filter(
          (movement) => movement.referenceId && ids.has(movement.referenceId),
        );
      }
      return filtered;
    },
  };
}

describe("UnasOrderStockAuditService.auditPage", () => {
  it("decorates a row with DUPLICATE_UNAS_KEY when its UNAS key is shared by another order", async () => {
    const db = new FakeAuditDb();
    db.orders.push(
      { id: "order-1", orderNumber: "UNAS-1", status: "CONFIRMED", lines: [] },
      { id: "order-2", orderNumber: "UNAS-2", status: "CONFIRMED", lines: [] },
    );
    db.references.push(
      { entityId: "order-1", externalId: "UN-DUP" },
      { entityId: "order-2", externalId: "UN-DUP" },
    );
    const service = new UnasOrderStockAuditService(
      new UnasOrderStockAuditRepository(db),
    );
    const page = await service.auditPage({ page: 1, pageSize: 10 });
    assert.ok(
      page.items.every((row) => row.riskFlags.includes("DUPLICATE_UNAS_KEY")),
    );
  });

  it("computes per-variant target/booked/delta strings for a partially-synced order", async () => {
    const db = new FakeAuditDb();
    db.orders.push({
      id: "order-1",
      orderNumber: "UNAS-1",
      status: "CONFIRMED",
      lines: [{ variantId: "v1", quantity: d("3") }],
    });
    db.references.push({ entityId: "order-1", externalId: "UN-1" });
    db.movements.push({
      referenceId: "order-1",
      type: "SALE",
      lines: [{ variantId: "v1", quantity: d("1") }],
    });
    const service = new UnasOrderStockAuditService(
      new UnasOrderStockAuditRepository(db),
    );
    const page = await service.auditPage({ page: 1, pageSize: 10 });
    const row = page.items[0]!;
    assert.equal(row.targetOutByVariant.v1, "3");
    assert.equal(row.bookedOutByVariant.v1, "1");
    assert.equal(row.deltaByVariant.v1, "2");
    assert.ok(row.riskFlags.length === 0); // target>0, booked>0 - not "zero booked", so no ACTIVE_ORDER_ZERO_BOOKED
  });

  it("compares a package order against its component ledger targets", async () => {
    const db = new FakeAuditDb();
    db.variants.push(
      {
        id: "bundle",
        sku: "BUNDLE",
        isPackageProduct: true,
        packageComponents: [{ sku: "COMP", qty: "2" }],
      },
      { id: "component", sku: "COMP" },
    );
    db.orders.push({
      id: "order-1",
      orderNumber: "UNAS-1",
      status: "CONFIRMED",
      lines: [{ variantId: "bundle", quantity: d("3") }],
    });
    db.references.push({ entityId: "order-1", externalId: "UN-1" });
    db.movements.push({
      referenceId: "order-1",
      type: "SALE",
      lines: [{ variantId: "component", quantity: d("6") }],
    });

    const page = await new UnasOrderStockAuditService(
      new UnasOrderStockAuditRepository(db),
    ).auditPage({ page: 1, pageSize: 10 });

    assert.deepEqual(page.items[0]?.targetOutByVariant, { component: "6" });
    assert.deepEqual(page.items[0]?.deltaByVariant, { component: "0" });
    assert.deepEqual(page.items[0]?.riskFlags, []);
  });

  it("paginates across many orders", async () => {
    const db = new FakeAuditDb();
    for (let index = 0; index < 3; index += 1) {
      db.orders.push({
        id: `order-${index}`,
        orderNumber: `UNAS-${index}`,
        status: "CONFIRMED",
        lines: [],
      });
    }
    const service = new UnasOrderStockAuditService(
      new UnasOrderStockAuditRepository(db),
    );
    const first = await service.auditPage({ page: 1, pageSize: 2 });
    const second = await service.auditPage({ page: 2, pageSize: 2 });
    assert.equal(first.items.length, 2);
    assert.equal(second.items.length, 1);
    assert.equal(first.totalItems, 3);
  });
});

describe("UnasOrderStockAuditService.summarize", () => {
  it("is safeToActivateWithoutBackfill=true for a clean set of orders", async () => {
    const db = new FakeAuditDb();
    db.orders.push({
      id: "order-1",
      orderNumber: "UNAS-1",
      status: "CONFIRMED",
      lines: [{ variantId: "v1", quantity: d("2") }],
    });
    db.references.push({ entityId: "order-1", externalId: "UN-1" });
    db.movements.push({
      referenceId: "order-1",
      type: "SALE",
      lines: [{ variantId: "v1", quantity: d("2") }],
    });
    const service = new UnasOrderStockAuditService(
      new UnasOrderStockAuditRepository(db),
    );
    const summary = await service.summarize();
    assert.equal(summary.safeToActivateWithoutBackfill, true);
    assert.deepEqual(summary.blockingReasons, []);
    assert.equal(summary.ordersChecked, 1);
    assert.equal(summary.ordersWithRiskFlags, 0);
  });

  it("is safeToActivateWithoutBackfill=false when any order carries a risk flag", async () => {
    const db = new FakeAuditDb();
    db.orders.push({
      id: "order-1",
      orderNumber: "UNAS-1",
      status: "CONFIRMED",
      lines: [{ variantId: "v1", quantity: d("2") }],
    });
    db.references.push({ entityId: "order-1", externalId: "UN-1" });
    // No stock movement at all - ACTIVE_ORDER_ZERO_BOOKED.
    const service = new UnasOrderStockAuditService(
      new UnasOrderStockAuditRepository(db),
    );
    const summary = await service.summarize();
    assert.equal(summary.safeToActivateWithoutBackfill, false);
    assert.equal(summary.riskFlagCounts.ACTIVE_ORDER_ZERO_BOOKED, 1);
    assert.ok(summary.blockingReasons.length > 0);
  });

  it("is safeToActivateWithoutBackfill=false when an orphan StockMovement reference exists, even with zero risky orders", async () => {
    const db = new FakeAuditDb();
    db.orders.push({
      id: "order-1",
      orderNumber: "UNAS-1",
      status: "CONFIRMED",
      lines: [],
    });
    db.references.push({ entityId: "order-1", externalId: "UN-1" });
    db.movements.push({ referenceId: "order-ghost", type: "SALE", lines: [] });
    const service = new UnasOrderStockAuditService(
      new UnasOrderStockAuditRepository(db),
    );
    const summary = await service.summarize();
    assert.equal(summary.orphanStockMovementReferenceCount, 1);
    assert.equal(summary.safeToActivateWithoutBackfill, false);
  });
});

describe("UnasOrderStockAuditService.findAnomalies", () => {
  it("never mutates any table - both underlying repository queries are pure reads", async () => {
    const db = new FakeAuditDb();
    db.references.push(
      { entityId: "order-1", externalId: "UN-DUP" },
      { entityId: "order-2", externalId: "UN-DUP" },
    );
    const service = new UnasOrderStockAuditService(
      new UnasOrderStockAuditRepository(db),
    );
    const before =
      JSON.stringify(db.orders) +
      JSON.stringify(db.references) +
      JSON.stringify(db.movements);
    await service.findAnomalies();
    const after =
      JSON.stringify(db.orders) +
      JSON.stringify(db.references) +
      JSON.stringify(db.movements);
    assert.equal(before, after);
  });
});
