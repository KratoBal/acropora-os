import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@acropora/database";

import {
  computeCurrentTargetOut,
  computeRiskFlags,
  UnasOrderStockAuditRepository,
  type UnasOrderStockAuditDatabase,
} from "./unas-order-stock-audit.repository.js";

function d(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

describe("computeCurrentTargetOut", () => {
  it("sums quantity by variantId, skipping lines with a null variantId", () => {
    const target = computeCurrentTargetOut([
      { variantId: "v1", quantity: d("2") },
      { variantId: "v1", quantity: d("1") },
      { variantId: null, quantity: d("999") }, // technical-cost/unresolved line
      { variantId: "v2", quantity: d("5") },
    ]);
    assert.equal(target.get("v1")?.toString(), "3");
    assert.equal(target.get("v2")?.toString(), "5");
    assert.equal(target.has("999"), false);
  });
});

describe("computeRiskFlags", () => {
  it("flags MISSING_EXTERNAL_REFERENCE when there's no UNAS key", () => {
    const flags = computeRiskFlags({
      status: "CONFIRMED",
      unasKey: null,
      targetOut: new Map(),
      bookedOut: new Map(),
    });
    assert.ok(flags.includes("MISSING_EXTERNAL_REFERENCE"));
  });

  it("flags ACTIVE_ORDER_ZERO_BOOKED when a live order's target is positive but nothing is booked", () => {
    const flags = computeRiskFlags({
      status: "CONFIRMED",
      unasKey: "UN-1",
      targetOut: new Map([["v1", d("2")]]),
      bookedOut: new Map(),
    });
    assert.ok(flags.includes("ACTIVE_ORDER_ZERO_BOOKED"));
  });

  it("does NOT flag ACTIVE_ORDER_ZERO_BOOKED when the order's target is correctly booked", () => {
    const flags = computeRiskFlags({
      status: "CONFIRMED",
      unasKey: "UN-1",
      targetOut: new Map([["v1", d("2")]]),
      bookedOut: new Map([["v1", d("2")]]),
    });
    assert.ok(!flags.includes("ACTIVE_ORDER_ZERO_BOOKED"));
  });

  it("flags CANCELLED_ORDER_POSITIVE_BOOKED when a cancelled order still shows positive bookedOut", () => {
    const flags = computeRiskFlags({
      status: "CANCELLED",
      unasKey: "UN-1",
      targetOut: new Map(),
      bookedOut: new Map([["v1", d("2")]]),
    });
    assert.ok(flags.includes("CANCELLED_ORDER_POSITIVE_BOOKED"));
  });

  it("does NOT flag CANCELLED_ORDER_POSITIVE_BOOKED when a cancelled order's bookedOut is already zero", () => {
    const flags = computeRiskFlags({
      status: "CANCELLED",
      unasKey: "UN-1",
      targetOut: new Map(),
      bookedOut: new Map([["v1", d("0")]]),
    });
    assert.ok(!flags.includes("CANCELLED_ORDER_POSITIVE_BOOKED"));
  });

  it("flags NEGATIVE_BOOKED_QUANTITY when any variant's bookedOut is negative - structurally impossible under correct operation", () => {
    const flags = computeRiskFlags({
      status: "CONFIRMED",
      unasKey: "UN-1",
      targetOut: new Map([["v1", d("1")]]),
      bookedOut: new Map([["v1", d("-1")]]),
    });
    assert.ok(flags.includes("NEGATIVE_BOOKED_QUANTITY"));
  });

  it("is flag-free for a healthy, fully-synced live order", () => {
    const flags = computeRiskFlags({
      status: "CONFIRMED",
      unasKey: "UN-1",
      targetOut: new Map([["v1", d("2")]]),
      bookedOut: new Map([["v1", d("2")]]),
    });
    assert.deepEqual(flags, []);
  });
});

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

  salesOrder = {
    findMany: async (args: { where?: { id?: { in: string[] } }; skip?: number; take?: number }) => {
      let filtered = this.orders;
      if (args.where?.id) {
        const ids = new Set(args.where.id.in);
        filtered = filtered.filter((order) => ids.has(order.id));
      }
      const sorted = [...filtered].sort((a, b) => a.id.localeCompare(b.id));
      return sorted.slice(args.skip ?? 0, (args.skip ?? 0) + (args.take ?? sorted.length));
    },
    count: async () => this.orders.length,
  };

  externalReference = {
    findMany: async (args: { where: { entityId?: { in: string[] }; externalId?: { in: string[] } } }) => {
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
        filtered = filtered.filter((movement) => movement.referenceId && ids.has(movement.referenceId));
      }
      return filtered;
    },
  };
}

describe("UnasOrderStockAuditRepository", () => {
  it("pairs each order with its ExternalReference and ledger-derived bookedOut in one batched pass", async () => {
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

    const repository = new UnasOrderStockAuditRepository(db);
    const page = await repository.auditPage({ page: 1, pageSize: 10 });
    assert.equal(page.orders.length, 1);
    assert.equal(page.unasKeyByOrderId.get("order-1"), "UN-1");
    assert.equal(page.bookedOutByOrderId.get("order-1")?.get("v1")?.toString(), "2");
    assert.equal(page.totalItems, 1);
  });

  it("finds a UNAS key shared by more than one local SalesOrder", async () => {
    const db = new FakeAuditDb();
    db.references.push(
      { entityId: "order-1", externalId: "UN-DUP" },
      { entityId: "order-2", externalId: "UN-DUP" },
      { entityId: "order-3", externalId: "UN-UNIQUE" },
    );
    const repository = new UnasOrderStockAuditRepository(db);
    const duplicates = await repository.findDuplicateUnasKeys();
    assert.equal(duplicates.length, 1);
    assert.equal(duplicates[0]!.unasKey, "UN-DUP");
    assert.deepEqual(new Set(duplicates[0]!.salesOrderIds), new Set(["order-1", "order-2"]));
  });

  it("finds a StockMovement referencing a SalesOrder id that no longer exists (orphan reference)", async () => {
    const db = new FakeAuditDb();
    db.orders.push({ id: "order-1", orderNumber: "UNAS-1", status: "CONFIRMED", lines: [] });
    db.movements.push(
      { referenceId: "order-1", type: "SALE", lines: [] },
      { referenceId: "order-does-not-exist", type: "SALE", lines: [] },
    );
    const repository = new UnasOrderStockAuditRepository(db);
    const orphans = await repository.findOrphanStockMovementReferences();
    assert.deepEqual(orphans, ["order-does-not-exist"]);
  });

  it("never writes anything - the injected FakeDb only implements findMany/count/groupBy", () => {
    const db = new FakeAuditDb();
    for (const modelName of ["salesOrder", "externalReference", "stockMovement"] as const) {
      for (const methodName of Object.keys(db[modelName])) {
        assert.ok(
          ["findMany", "count", "groupBy"].includes(methodName),
          `unexpected mutating-looking method ${modelName}.${methodName}`,
        );
      }
    }
  });
});
