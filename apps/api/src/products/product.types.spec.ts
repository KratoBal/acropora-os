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
    origin: "LOCAL",
    catalogAuthority: "ACROPORA",
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
  it("sums StockItem.onHand across warehouses and active variants", () => {
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
        {
          id: "variant-2",
          sku: "sku-2",
          isActive: true,
          stockItems: [{ onHand: new Prisma.Decimal("4") }],
        },
        {
          id: "variant-retired",
          sku: "sku-retired",
          isActive: false,
          stockItems: [{ onHand: new Prisma.Decimal("100") }],
        },
      ],
    } as unknown as Partial<ProductWithRelations>);

    assert.equal(toProductListItem(product).stockOnHand, "9");
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
    assert.equal(item.origin, "LOCAL");
    assert.equal(item.catalogAuthority, "ACROPORA");
    assert.equal(item.grossPrice, null);
    assert.equal(item.saleGrossPrice, null);
    assert.equal(item.stockOnHand, null);
  });
});

describe("which price the list is showing", () => {
  const withSnapshot = (grossPrice: string) =>
    ({
      grossPrice: new Prisma.Decimal(grossPrice),
      saleGrossPrice: null,
      isPackageProduct: false,
    }) as unknown as ProductWithRelations["unasSnapshot"];

  it("says the mirror is still maintained while the shop owns the product", () => {
    const item = toProductListItem(
      baseProduct({
        catalogAuthority: "UNAS",
        unasSnapshot: withSnapshot("4990"),
      }),
    );

    assert.equal(item.priceSource, "unas");
    assert.equal(item.grossPrice, "4990");
  });

  /**
   * THE ONE THE FIELD EXISTS FOR. After a takeover the import stops writing the
   * snapshot, so this column shows the last price the shop had - and the number
   * alone cannot say so.
   */
  it("says the mirror is FROZEN once the product is ours", () => {
    const item = toProductListItem(
      baseProduct({
        catalogAuthority: "ACROPORA",
        unasSnapshot: withSnapshot("4990"),
      }),
    );

    assert.equal(item.priceSource, "unas_frozen");
  });

  it("does not change the number it labels", () => {
    // The value is deliberately untouched: showing our own price instead would
    // decide on the business's behalf what a colleague sees on a live screen.
    const taken = baseProduct({
      catalogAuthority: "ACROPORA",
      unasSnapshot: withSnapshot("4990"),
    });
    const theirs = baseProduct({
      catalogAuthority: "UNAS",
      unasSnapshot: withSnapshot("4990"),
    });

    assert.equal(
      toProductListItem(taken).grossPrice,
      toProductListItem(theirs).grossPrice,
    );
  });

  it("says there is no source at all for a purely local product", () => {
    const item = toProductListItem(
      baseProduct({ catalogAuthority: "ACROPORA", unasSnapshot: null }),
    );

    assert.equal(item.priceSource, "none");
    assert.equal(item.grossPrice, null);
  });

  it("treats an unset authority as the shop's, like every other read", () => {
    const item = toProductListItem(
      baseProduct({
        catalogAuthority: null,
        unasSnapshot: withSnapshot("4990"),
      }),
    );

    assert.equal(item.priceSource, "unas");
  });
});
