import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@acropora/database";

import {
  toUnasOrderDetail,
  toUnasOrderListItem,
  type SalesOrderListWithRelations,
  type SalesOrderWithRelations,
} from "./unas-order-sync.types.js";

describe("toUnasOrderDetail", () => {
  it("maps totals, buyer info and lines to plain strings", () => {
    const order: SalesOrderWithRelations = {
      id: "order-1",
      orderNumber: "UNAS-1001",
      status: "CONFIRMED",
      buyerName: "Kovács Anna",
      buyerEmail: "vevo@example.com",
      currency: "HUF",
      totalNet: new Prisma.Decimal("10000"),
      totalTax: new Prisma.Decimal("2700"),
      totalGross: new Prisma.Decimal("12700"),
      orderedAt: new Date("2026-07-20T14:05:00.000Z"),
      createdAt: new Date("2026-07-20T14:06:00.000Z"),
      lines: [
        {
          id: "line-1",
          variantId: "variant-1",
          sku: "pump_1",
          description: "Reef Pump",
          quantity: new Prisma.Decimal("2"),
          unit: "db",
          unitNet: new Prisma.Decimal("5000"),
          taxRate: new Prisma.Decimal("27"),
          lineGross: new Prisma.Decimal("12700"),
          syncStatus: "OK",
          syncError: null,
        },
      ],
    };

    const detail = toUnasOrderDetail(order);
    assert.equal(detail.orderNumber, "UNAS-1001");
    assert.equal(detail.buyerName, "Kovács Anna");
    assert.equal(detail.totalGross, "12700");
    assert.equal(detail.orderedAt, "2026-07-20T14:05:00.000Z");
    assert.equal(detail.lines.length, 1);
    assert.equal(detail.lines[0]?.sku, "pump_1");
    assert.equal(detail.lines[0]?.quantity, "2");
  });

  it("handles a null orderedAt", () => {
    const order: SalesOrderWithRelations = {
      id: "order-2",
      orderNumber: "UNAS-1002",
      status: "CONFIRMED",
      buyerName: null,
      buyerEmail: null,
      currency: "HUF",
      totalNet: new Prisma.Decimal("0"),
      totalTax: new Prisma.Decimal("0"),
      totalGross: new Prisma.Decimal("0"),
      orderedAt: null,
      createdAt: new Date("2026-07-20T14:06:00.000Z"),
      lines: [],
    };
    assert.equal(toUnasOrderDetail(order).orderedAt, null);
  });
});

describe("toUnasOrderListItem", () => {
  it("maps a summary row including the line count", () => {
    const order: SalesOrderListWithRelations = {
      id: "order-1",
      orderNumber: "UNAS-1001",
      status: "CONFIRMED",
      buyerName: "Kovács Anna",
      totalGross: new Prisma.Decimal("12700"),
      currency: "HUF",
      orderedAt: new Date("2026-07-20T14:05:00.000Z"),
      createdAt: new Date("2026-07-20T14:06:00.000Z"),
      _count: { lines: 3 },
    };
    const item = toUnasOrderListItem(order);
    assert.equal(item.lineCount, 3);
    assert.equal(item.totalGross, "12700");
    assert.equal(item.buyerName, "Kovács Anna");
  });
});
