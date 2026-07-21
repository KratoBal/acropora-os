import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@acropora/database";

import {
  toInventoryCountDetail,
  type InventoryCountWithRelations,
} from "./inventory-count.types.js";

function line(
  sku: string,
  countedQty: string | null,
): InventoryCountWithRelations["lines"][number] {
  return {
    id: `line-${sku}`,
    variantId: `variant-${sku}`,
    expectedQty: new Prisma.Decimal("10"),
    countedQty: countedQty === null ? null : new Prisma.Decimal(countedQty),
    syncStatus: "PENDING",
    syncError: null,
    variant: { sku, product: { name: `Termék ${sku}` } },
  };
}

function count(
  status: InventoryCountWithRelations["status"],
  lines: InventoryCountWithRelations["lines"],
): InventoryCountWithRelations {
  return {
    id: "count-1",
    countNumber: "LELTAR-1",
    status,
    warehouseId: "warehouse-1",
    createdAt: new Date("2026-07-21T10:00:00.000Z"),
    uploadedAt: null,
    correctedAt: null,
    warehouse: { name: "Fő raktár" },
    startedBy: { displayName: "Teszt Felhasználó" },
    lines,
  };
}

describe("toInventoryCountDetail line ordering", () => {
  it("keeps alphabetical order while every line is still uncounted (DRAFT)", () => {
    const detail = toInventoryCountDetail(
      count("DRAFT", [line("B-SKU", null), line("A-SKU", null)]),
    );
    assert.deepEqual(
      detail.lines.map((l) => l.sku),
      ["A-SKU", "B-SKU"],
    );
  });

  it("floats not-yet-counted lines to the top once the count has been uploaded", () => {
    const detail = toInventoryCountDetail(
      count("UPLOADED", [
        line("A-SKU", "10"),
        line("C-SKU", null),
        line("B-SKU", "9"),
      ]),
    );
    assert.deepEqual(
      detail.lines.map((l) => l.sku),
      ["C-SKU", "A-SKU", "B-SKU"],
    );
  });
});
