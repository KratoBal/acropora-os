import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@acropora/database";

import {
  toPosSaleDetail,
  toPosSaleListItem,
  type SalesOrderListWithRelations,
  type SalesOrderWithRelations,
} from "./pos-sale.types.js";

describe("toPosSaleDetail", () => {
  it("maps an order and its lines, falling back to null for missing customer/cashier", () => {
    const order: SalesOrderWithRelations = {
      id: "sale-1",
      orderNumber: "POS-1",
      status: "COMPLETED",
      paymentMethod: "CASH",
      currency: "HUF",
      totalNet: new Prisma.Decimal("200"),
      totalTax: new Prisma.Decimal("54"),
      totalGross: new Prisma.Decimal("254"),
      createdAt: new Date("2026-07-21T10:00:00.000Z"),
      completedAt: new Date("2026-07-21T10:00:05.000Z"),
      customer: null,
      soldBy: { displayName: "Teszt Pénztáros" },
      lines: [
        {
          id: "line-1",
          variantId: "variant-1",
          sku: "REEF-SALT-01",
          description: "Reef Salt",
          quantity: new Prisma.Decimal("2"),
          unit: "db",
          unitNet: new Prisma.Decimal("100"),
          taxRate: new Prisma.Decimal("27"),
          lineGross: new Prisma.Decimal("254"),
          syncStatus: "OK",
          syncError: null,
        },
      ],
    };

    const detail = toPosSaleDetail(order);

    assert.equal(detail.customerName, null);
    assert.equal(detail.soldByName, "Teszt Pénztáros");
    assert.equal(detail.totalGross, "254");
    assert.equal(detail.lines.length, 1);
    assert.equal(detail.lines[0]?.productName, "Reef Salt");
    assert.equal(detail.lines[0]?.quantity, "2");
  });
});

describe("toPosSaleListItem", () => {
  it("maps a list row including the line count", () => {
    const row: SalesOrderListWithRelations = {
      id: "sale-1",
      orderNumber: "POS-1",
      status: "COMPLETED",
      paymentMethod: "CARD",
      totalGross: new Prisma.Decimal("254"),
      createdAt: new Date("2026-07-21T10:00:00.000Z"),
      customer: { displayName: "Kiss Anna" },
      soldBy: null,
      _count: { lines: 3 },
    };

    const item = toPosSaleListItem(row);

    assert.equal(item.customerName, "Kiss Anna");
    assert.equal(item.soldByName, null);
    assert.equal(item.lineCount, 3);
    assert.equal(item.paymentMethod, "CARD");
  });
});
