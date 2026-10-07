import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@acropora/database";

import {
  costWarnings,
  decideCostSnapshot,
  snapshotCost,
  type CostSnapshotDatabase,
  type PurchaseLineForCost,
} from "./quote-cost-snapshot.js";

const d = (v: string) => new Prisma.Decimal(v);
const line = (
  currency: string,
  rate: string | null,
  unitNet = "100",
  discount: string | null = null,
): PurchaseLineForCost => ({
  id: "line-1",
  unitNet: d(unitNet),
  discountPercent: discount === null ? null : d(discount),
  purchaseInvoice: {
    currency,
    exchangeRate: rate === null ? null : d(rate),
    invoiceDate: new Date("2026-09-01T00:00:00Z"),
    supplierId: "sup-1",
  },
});

describe("quote BOM cost snapshot", () => {
  it("a discounted HUF line: net after the discount, with its source line", () => {
    const s = decideCostSnapshot(line("HUF", null, "1000", "10"), null);
    assert.equal(s.unitCost?.toString(), "900");
    assert.equal(s.exchangeRate, null);
    assert.equal(s.costSource, "LAST_PURCHASE");
    assert.equal(s.sourcePurchaseInvoiceLineId, "line-1");
    assert.equal(s.supplierId, "sup-1");
  });

  it("a discounted EUR line: HUF via the invoice's stored rate, the original kept", () => {
    const s = decideCostSnapshot(line("EUR", "400.5", "10", "20"), null);
    // 10 * 0.8 = 8 EUR, 8 * 400.5 = 3204 HUF
    assert.equal(s.unitCost?.toString(), "3204");
    assert.equal(s.costOriginal?.toString(), "8");
    assert.equal(s.costCurrency, "EUR");
    assert.equal(s.exchangeRate?.toString(), "400.5");
  });

  it("an EUR line without a rate falls back, and the fallback has no source line", () => {
    const s = decideCostSnapshot(line("EUR", null), {
      lastPurchaseNetPrice: d("777"),
      defaultPurchaseCurrency: "HUF",
    });
    assert.equal(s.unitCost?.toString(), "777");
    assert.equal(s.costSource, "LAST_PURCHASE");
    assert.equal(s.sourcePurchaseInvoiceLineId, null);
    assert.deepEqual(costWarnings("X", { kind: "PRODUCT", ...s }), [
      "X: a költség a termék utolsó beszerzési árából jön (tartalék), nem bevételezett számlasorból.",
    ]);
  });

  it("a foreign fallback is NEVER stored as HUF", () => {
    const s = decideCostSnapshot(null, {
      lastPurchaseNetPrice: d("12"),
      defaultPurchaseCurrency: "EUR",
    });
    assert.equal(s.unitCost, null);
    assert.equal(s.costOriginal?.toString(), "12");
    assert.equal(s.costCurrency, "EUR");
    assert.match(
      costWarnings("X", { kind: "PRODUCT", ...s })[0]!,
      /EUR pénznemű/,
    );
  });

  it("no line and no fallback: no cost", () => {
    const s = decideCostSnapshot(null, null);
    assert.equal(s.unitCost, null);
    assert.equal(s.costSource, null);
  });

  it("asks for POSTED invoices only, newest by invoice DATE first", async () => {
    let args: { where: unknown; orderBy: unknown[] } | undefined;
    const db: CostSnapshotDatabase = {
      purchaseInvoiceLine: {
        findFirst: async (a) => {
          args = a as typeof args;
          return null;
        },
      },
      productVariant: { findUnique: async () => null },
    };
    await snapshotCost(db, "var-1");
    assert.deepEqual(args!.where, {
      variantId: "var-1",
      purchaseInvoice: { status: "POSTED" },
    });
    assert.deepEqual(args!.orderBy[0], {
      purchaseInvoice: { invoiceDate: "desc" },
    });
  });
});
