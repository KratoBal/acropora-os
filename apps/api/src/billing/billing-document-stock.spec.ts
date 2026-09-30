import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import {
  planInvoiceStock,
  type StockComponentVariant,
  type StockProduct,
} from "./billing-document-stock.js";

const D = (value: string) => new Prisma.Decimal(value);

const product = (overrides: Partial<StockProduct> = {}): StockProduct => ({
  id: "p-unas",
  type: "PHYSICAL",
  catalogAuthority: "UNAS",
  variants: [{ id: "v-unas", sku: "UNAS-1", unit: "db" }],
  isPackageProduct: false,
  packageComponents: null,
  ...overrides,
});

const PRODUCTS = new Map<string, StockProduct>([
  ["p-unas", product()],
  [
    "p-local",
    product({
      id: "p-local",
      catalogAuthority: "ACROPORA",
      variants: [{ id: "v-local", sku: "ACR-1", unit: "db" }],
    }),
  ],
  ["p-service", product({ id: "p-service", type: "SERVICE" })],
  [
    "p-multi",
    product({
      id: "p-multi",
      variants: [
        { id: "v-a", sku: "M-A", unit: "db" },
        { id: "v-b", sku: "M-B", unit: "db" },
      ],
    }),
  ],
  ["p-none", product({ id: "p-none", variants: [] })],
  [
    "p-package",
    product({
      id: "p-package",
      variants: [{ id: "v-package", sku: "PKG", unit: "db" }],
      isPackageProduct: true,
      packageComponents: [
        { sku: "C-1", qty: 2 },
        { sku: "C-2", qty: 1 },
      ],
    }),
  ],
]);

const COMPONENTS = new Map<string, StockComponentVariant>([
  [
    "C-1",
    {
      id: "v-c1",
      sku: "C-1",
      unit: "db",
      catalogAuthority: "UNAS",
      isPackageProduct: false,
    },
  ],
  [
    "C-2",
    {
      id: "v-c2",
      sku: "C-2",
      unit: "db",
      catalogAuthority: "UNAS",
      isPackageProduct: false,
    },
  ],
]);

const line = (
  id: string,
  productId: string | null,
  quantity = "1",
  kind = "ITEM",
) => ({
  id,
  kind,
  productId,
  quantity: D(quantity),
});

const plan = (
  lines: ReturnType<typeof line>[],
  overrides: { documentType?: string; sourceType?: string | null } = {},
  componentsBySku = COMPONENTS,
) =>
  planInvoiceStock({
    documentType: overrides.documentType ?? "INVOICE",
    sourceType:
      overrides.sourceType === undefined ? "MANUAL" : overrides.sourceType,
    lines,
    products: PRODUCTS,
    componentsBySku,
  });

const moves = (result: ReturnType<typeof plan>) =>
  result.movement.map((m) => [m.sku, m.quantityDelta.toString(), m.syncToUnas]);

describe("planInvoiceStock", () => {
  it("books a single-variant product out, UNAS-mastered to UNAS and local only locally", () => {
    const result = plan([
      line("a", "p-unas", "2"),
      line("b", "p-local", "1.5"),
    ]);
    assert.deepEqual(moves(result), [
      ["UNAS-1", "-2", true],
      ["ACR-1", "-1.5", false],
    ]);
    assert.deepEqual([...result.outcomes.values()], ["MOVED", "MOVED"]);
  });

  it("merges two lines of the same variant into one movement line", () => {
    assert.deepEqual(
      moves(plan([line("a", "p-unas", "2"), line("b", "p-unas", "3")])),
      [["UNAS-1", "-5", true]],
    );
  });

  it("gives every line not moved its own reason", () => {
    const result = plan([
      line("custom", null),
      line("discount", "p-unas", "1", "DISCOUNT"),
      line("service", "p-service"),
      line("multi", "p-multi"),
      line("none", "p-none"),
    ]);
    assert.deepEqual(Object.fromEntries(result.outcomes), {
      custom: "NOT_STOCKED",
      discount: "NOT_STOCKED",
      service: "NOT_STOCKED",
      multi: "VARIANT_NOT_CHOSEN",
      none: "NO_VARIANT",
    });
    assert.deepEqual(result.movement, []);
  });

  it("moves nothing on a source that already moved the stock", () => {
    for (const sourceType of ["SALES_ORDER", "POS_TRANSACTION"]) {
      const result = plan([line("a", "p-unas")], { sourceType });
      assert.deepEqual(result.movement, [], sourceType);
      assert.equal(result.outcomes.get("a"), "MOVED_BY_SOURCE");
    }
    for (const sourceType of ["SERVICE_JOB", "PROJECT", "MANUAL", null]) {
      const result = plan([line("a", "p-unas")], { sourceType });
      assert.equal(result.outcomes.get("a"), "MOVED", String(sourceType));
    }
  });

  it("moves stock only on an invoice, not on a proforma, an advance or a delivery note", () => {
    for (const documentType of [
      "PROFORMA",
      "ADVANCE_INVOICE",
      "DELIVERY_NOTE",
    ]) {
      const result = plan([line("a", "p-unas")], { documentType });
      assert.deepEqual(result.movement, [], documentType);
      assert.equal(result.outcomes.get("a"), "NOT_A_STOCK_DOCUMENT");
    }
  });

  it("books a package out through its components, and not at all when one is missing", () => {
    assert.deepEqual(moves(plan([line("a", "p-package", "3")])), [
      ["C-1", "-6", true],
      ["C-2", "-3", true],
    ]);
    const partial = plan(
      [line("a", "p-package", "3")],
      {},
      new Map([["C-1", COMPONENTS.get("C-1")!]]),
    );
    assert.deepEqual(partial.movement, []);
    assert.equal(partial.outcomes.get("a"), "PACKAGE_UNRESOLVED");
  });
});
