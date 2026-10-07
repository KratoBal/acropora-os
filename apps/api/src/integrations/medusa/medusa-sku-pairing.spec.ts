import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  listAllShopSkus,
  osSkuIndex,
  pairShopProducts,
  type ShopSkuProduct,
} from "./medusa-sku-pairing.js";

/**
 * A BOLTI ÉS AZ OS TERMÉKEK SKU-PÁROSÍTÁSA. MI PIROSÍT: ha a kis- és nagybetű vagy
 * a szóköz párt ront; ha a UNAS cikkszám nem számít; ha egy több OS termékre
 * mutató SKU, vagy egy több bolti termék által választott OS termék párt kap.
 */
const shop = (id: string, ...skus: (string | null)[]): ShopSkuProduct => ({
  id,
  external_id: `old-${id}`,
  variants: skus.map((sku) => ({ sku })),
});

describe("pairShopProducts", () => {
  it("az OS változat SKU-ja párt ad, kis- és nagybetűtől és szóköztől függetlenül", () => {
    const index = osSkuIndex([{ sku: " DMBS1KG ", productId: "os-1" }], []);
    assert.deepEqual(pairShopProducts(index, [shop("sh-1", "dmbs1kg")]), [
      {
        kind: "pair",
        shopProductId: "sh-1",
        osProductId: "os-1",
        externalId: "old-sh-1",
      },
    ]);
  });

  it("a UNAS cikkszám is kulcs", () => {
    const index = osSkuIndex(
      [],
      [{ productId: "os-2", rawPayload: { Sku: "KZ-100" } }],
    );
    assert.equal(
      pairShopProducts(index, [shop("sh-2", "KZ-100")])[0]!.kind,
      "pair",
    );
  });

  it("egy több OS termékre mutató SKU kétértelmű, és mindkét OS termék látszik", () => {
    const index = osSkuIndex(
      [
        { sku: "A", productId: "os-1" },
        { sku: "A", productId: "os-2" },
      ],
      [],
    );
    assert.deepEqual(pairShopProducts(index, [shop("sh-1", "A")]), [
      {
        kind: "ambiguous-sku",
        shopProductId: "sh-1",
        osProductIds: ["os-1", "os-2"],
      },
    ]);
  });

  it("ismeretlen SKU és SKU nélküli termék: nincs pár", () => {
    const index = osSkuIndex([{ sku: "A", productId: "os-1" }], []);
    assert.deepEqual(
      pairShopProducts(index, [
        shop("sh-1", "B"),
        { id: "sh-2", variants: null },
      ]).map((d) => d.kind),
      ["no-match", "no-match"],
    );
  });

  it("ha két bolti termék ugyanarra az OS termékre mutat, egyik sem kap párt", () => {
    const index = osSkuIndex(
      [
        { sku: "A", productId: "os-1" },
        { sku: "B", productId: "os-2" },
      ],
      [],
    );
    assert.deepEqual(
      pairShopProducts(index, [
        shop("sh-1", "A"),
        shop("sh-2", "A"),
        shop("sh-3", "B"),
      ]).map((d) => d.kind),
      ["shared-os-product", "shared-os-product", "pair"],
    );
  });

  it("egy termék két SKU-ja ugyanarra az OS termékre: pár", () => {
    const index = osSkuIndex(
      [
        { sku: "A", productId: "os-1" },
        { sku: "A2", productId: "os-1" },
      ],
      [],
    );
    assert.equal(
      pairShopProducts(index, [shop("sh-1", "A", "A2")])[0]!.kind,
      "pair",
    );
  });
});

describe("listAllShopSkus", () => {
  it("végiglapoz, és a count-nál megáll", async () => {
    const all = Array.from({ length: 5 }, (_, i) => shop(`sh-${i}`, `S${i}`));
    const offsets: number[] = [];
    const result = await listAllShopSkus(
      {
        listProductSkus: async (offset, limit) => {
          offsets.push(offset);
          return { products: all.slice(offset, offset + limit), count: 5 };
        },
      },
      2,
    );
    assert.deepEqual(
      result.map((p) => p.id),
      all.map((p) => p.id),
    );
    assert.deepEqual(offsets, [0, 2, 4]);
  });
});
