import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@acropora/database";

import {
  toPurchaseInvoiceDetail,
  toPurchaseInvoiceSummary,
  type PurchaseInvoiceDetailRow,
  type PurchaseInvoiceSummaryRow,
} from "./purchase-invoice.types.js";

function line(overrides: {
  actualQuantity: string;
  unitNet: string;
  discountPercent?: string | null;
}) {
  return {
    actualQuantity: new Prisma.Decimal(overrides.actualQuantity),
    unitNet: new Prisma.Decimal(overrides.unitNet),
    discountPercent: overrides.discountPercent
      ? new Prisma.Decimal(overrides.discountPercent)
      : null,
  };
}

function summaryRow(
  lines: ReturnType<typeof line>[],
): PurchaseInvoiceSummaryRow {
  return {
    id: "invoice-1",
    documentNumber: "BESZ-1",
    supplierInvoiceNumber: "INV-1",
    source: "EU",
    status: "POSTED",
    supplierId: "supplier-1",
    warehouseId: "warehouse-1",
    currency: "EUR",
    exchangeRate: new Prisma.Decimal("400"),
    invoiceDate: new Date("2026-07-20T00:00:00.000Z"),
    dueDate: null,
    isPaid: false,
    paidAt: null,
    vatRate: null,
    note: null,
    createdById: null,
    createdAt: new Date("2026-07-20T10:00:00.000Z"),
    updatedAt: new Date("2026-07-20T10:00:00.000Z"),
    supplier: { name: "Test Supplier" },
    lines,
  } as unknown as PurchaseInvoiceSummaryRow;
}

describe("toPurchaseInvoiceSummary", () => {
  it("sums line totals without a discount", () => {
    const summary = toPurchaseInvoiceSummary(
      summaryRow([line({ actualQuantity: "5", unitNet: "10" })]),
    );
    assert.equal(summary.totalNet, "50");
  });

  it("applies a per-line discount percentage before summing", () => {
    const summary = toPurchaseInvoiceSummary(
      summaryRow([
        line({ actualQuantity: "10", unitNet: "10", discountPercent: "20" }),
      ]),
    );
    // 10 * 10 = 100, minus 20% = 80
    assert.equal(summary.totalNet, "80");
  });

  it("sums multiple lines, some discounted and some not", () => {
    const summary = toPurchaseInvoiceSummary(
      summaryRow([
        line({ actualQuantity: "5", unitNet: "10" }),
        line({ actualQuantity: "10", unitNet: "10", discountPercent: "20" }),
      ]),
    );
    assert.equal(summary.totalNet, "130");
  });
});

describe("toPurchaseInvoiceDetail", () => {
  it("computes lineNet per line and carries through header fields", () => {
    const row = {
      ...summaryRow([]),
      lines: [
        {
          id: "line-1",
          purchaseInvoiceId: "invoice-1",
          variantId: "variant-1",
          sourceDescription: "Meersalz 25kg",
          orderedQuantity: new Prisma.Decimal("5"),
          actualQuantity: new Prisma.Decimal("5"),
          unit: "db",
          unitNet: new Prisma.Decimal("10"),
          discountPercent: null,
          syncStatus: "OK",
          syncError: null,
          variant: { sku: "REEF-SALT-01", product: { name: "Reef Salt" } },
        },
      ],
    } as unknown as PurchaseInvoiceDetailRow;

    const detail = toPurchaseInvoiceDetail(row);
    assert.equal(detail.lines.length, 1);
    assert.equal(detail.lines[0]?.lineNet, "50");
    assert.equal(detail.lines[0]?.sku, "REEF-SALT-01");
    assert.equal(detail.totalNet, "50");
    assert.equal(detail.supplierName, "Test Supplier");
  });
});
