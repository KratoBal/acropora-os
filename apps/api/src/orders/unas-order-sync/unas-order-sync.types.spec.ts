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
      unasDeletedAt: null,
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
      unasInvoiceStatus: null,
      invoices: [],
    };

    const detail = toUnasOrderDetail(order, {
      unasStatus: "Kiszállítás",
      unasStatusType: "open_normal",
      paymentName: "Bankkártya",
      paymentType: "bankcard",
      paymentStatus: "paid",
      shippingName: "GLS",
    });
    assert.equal(detail.orderNumber, "UNAS-1001");
    assert.equal(detail.buyerName, "Kovács Anna");
    assert.equal(detail.totalGross, "12700");
    assert.equal(detail.orderedAt, "2026-07-20T14:05:00.000Z");
    assert.equal(detail.unasStatusLabel, "Kiszállítás");
    assert.equal(detail.paymentName, "Bankkártya");
    assert.equal(detail.paymentStatus, "paid");
    assert.equal(detail.shippingName, "GLS");
    assert.equal(detail.lines.length, 1);
    assert.equal(detail.lines[0]?.sku, "pump_1");
    assert.equal(detail.lines[0]?.quantity, "2");
  });

  it("defaults metadata-derived fields to null when no metadata is given", () => {
    const order: SalesOrderWithRelations = {
      id: "order-3",
      orderNumber: "UNAS-1003",
      status: "CONFIRMED",
      buyerName: null,
      buyerEmail: null,
      currency: "HUF",
      totalNet: new Prisma.Decimal("0"),
      totalTax: new Prisma.Decimal("0"),
      totalGross: new Prisma.Decimal("0"),
      orderedAt: null,
      createdAt: new Date("2026-07-20T14:06:00.000Z"),
      unasDeletedAt: null,
      lines: [],
      unasInvoiceStatus: null,
      invoices: [],
    };
    const detail = toUnasOrderDetail(order);
    assert.equal(detail.unasStatusLabel, null);
    assert.equal(detail.paymentName, null);
    assert.equal(detail.shippingName, null);
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
      unasDeletedAt: null,
      lines: [],
      unasInvoiceStatus: null,
      invoices: [],
    };
    assert.equal(toUnasOrderDetail(order).orderedAt, null);
  });

  it("maps unasInvoiceStatus and a mirrored invoice when the order has been billed by UNAS", () => {
    const order: SalesOrderWithRelations = {
      id: "order-4",
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

    const detail = toUnasOrderDetail(order);
    assert.equal(detail.unasInvoiceStatus, "BILLED");
    assert.equal(detail.invoices.length, 1);
    assert.deepEqual(detail.invoices[0], {
      id: "invoice-1",
      invoiceNumber: "SZ-2026-000123",
      externalUrl: "https://szamlazz.hu/szamla/SZ-2026-000123.pdf",
      syncStatus: "RECEIVED",
      createdAt: "2026-07-21T09:00:00.000Z",
    });
  });

  it("returns an empty invoices array and null unasInvoiceStatus for an order UNAS has never billed", () => {
    const order: SalesOrderWithRelations = {
      id: "order-5",
      orderNumber: "UNAS-1005",
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

    const detail = toUnasOrderDetail(order);
    assert.equal(detail.unasInvoiceStatus, "BILLABLE");
    assert.deepEqual(detail.invoices, []);
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
    const item = toUnasOrderListItem(order, {
      unasStatus: "Megrendelés lezárva",
      paymentName: "Utánvét",
      shippingName: "FoxPost",
    });
    assert.equal(item.lineCount, 3);
    assert.equal(item.totalGross, "12700");
    assert.equal(item.buyerName, "Kovács Anna");
    assert.equal(item.unasStatusLabel, "Megrendelés lezárva");
    assert.equal(item.paymentName, "Utánvét");
    assert.equal(item.shippingName, "FoxPost");
  });

  it("defaults metadata-derived fields to null when no metadata is given", () => {
    const order: SalesOrderListWithRelations = {
      id: "order-2",
      orderNumber: "UNAS-1002",
      status: "CONFIRMED",
      buyerName: null,
      totalGross: new Prisma.Decimal("0"),
      currency: "HUF",
      orderedAt: null,
      createdAt: new Date("2026-07-20T14:06:00.000Z"),
      _count: { lines: 0 },
    };
    const item = toUnasOrderListItem(order);
    assert.equal(item.unasStatusLabel, null);
    assert.equal(item.paymentName, null);
    assert.equal(item.shippingName, null);
  });
});
