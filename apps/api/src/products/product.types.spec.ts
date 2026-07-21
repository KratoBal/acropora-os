import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@acropora/database";

import {
  toProductListItem,
  type ProductWithRelations,
} from "./product.types.js";

function baseProduct(
  overrides: Partial<ProductWithRelations> = {},
): ProductWithRelations {
  return {
    id: "product-1",
    name: "Reef Salt",
    type: "PHYSICAL",
    isActive: true,
    archivedAt: null,
    brand: null,
    categories: [],
    variants: [],
    channelListings: [],
    images: [],
    unasSnapshot: null,
    ...overrides,
  } as unknown as ProductWithRelations;
}

describe("toProductListItem", () => {
  it("sums StockItem.onHand across warehouses for the primary variant", () => {
    const product = baseProduct({
      variants: [
        {
          id: "variant-1",
          sku: "sku-1",
          isActive: true,
          stockItems: [
            { onHand: new Prisma.Decimal("3") },
            { onHand: new Prisma.Decimal("2") },
          ],
        },
      ],
    } as unknown as Partial<ProductWithRelations>);

    assert.equal(toProductListItem(product).stockOnHand, "5");
  });

  it("reports null stock (not 0) when the variant has no StockItem row at all", () => {
    const product = baseProduct({
      variants: [
        { id: "variant-1", sku: "sku-1", isActive: true, stockItems: [] },
      ],
    } as unknown as Partial<ProductWithRelations>);

    assert.equal(toProductListItem(product).stockOnHand, null);
  });

  it("reads gross/sale price from the UNAS snapshot when present", () => {
    const product = baseProduct({
      unasSnapshot: {
        grossPrice: new Prisma.Decimal("1270"),
        saleGrossPrice: new Prisma.Decimal("990"),
      },
    } as unknown as Partial<ProductWithRelations>);

    const item = toProductListItem(product);
    assert.equal(item.grossPrice, "1270");
    assert.equal(item.saleGrossPrice, "990");
  });

  it("defaults price fields to null for a non-UNAS-mirrored product", () => {
    const item = toProductListItem(baseProduct());
    assert.equal(item.grossPrice, null);
    assert.equal(item.saleGrossPrice, null);
    assert.equal(item.stockOnHand, null);
  });
});
