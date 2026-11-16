import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpException } from "@nestjs/common";

import { MedusaPickupAdoptionService } from "./medusa-pickup-adoption.service.js";
import type { PickupAdoptionDatabase } from "./medusa-pickup-adoption.js";
import type { MedusaShippingAttributesService } from "./medusa-shipping-attributes.service.js";

/*
  A VEGPONT SZOLGALTATASA (kartya c603774e, acrobot 45855). MI PIROSIT: a lista ir a boltba; a darabszamok (counts) nem a
  besorolasokbol jonnek; az apply nelkuli adopt ir; a regi bolton (nincs jelolo mezo) 409 helyett lista vagy iras; az elgepelt
  azonositot nem nevezi meg.
*/
const sor = (product_id: string, derived: boolean | undefined) => ({
  id: `sa_${product_id}`,
  product_id,
  pickup_only: true,
  ...(derived === undefined ? {} : { pickup_only_derived: derived }),
});

function kornyezet(regiBolt = false) {
  const jelolesek: { shop: string; apply: boolean }[] = [];
  const rows = [
    sor("shop-none", false),
    sor("shop-live", false),
    sor("shop-profile", false),
    sor("shop-marked", true),
  ];
  const shipping = {
    listShopShippingAttributes: async () =>
      regiBolt
        ? rows.map(({ pickup_only_derived: _ignored, ...rest }) => rest)
        : rows,
    osProductOfShop: async (shop: string) =>
      ({
        "shop-none": "os-none",
        "shop-live": "os-live",
        "shop-profile": "os-profile",
        "shop-marked": "os-marked",
      })[shop] ?? null,
    listShopSkus: async () => ({ products: [], count: 0 }),
    adoptPickupMark: async (row: { product_id: string }, apply: boolean) => {
      jelolesek.push({ shop: row.product_id, apply });
      return {
        action: apply ? "applied" : "planned",
        medusaProductId: row.product_id,
      };
    },
  } as unknown as MedusaShippingAttributesService;
  const database = {
    category: {
      findMany: async () => [
        { id: "c-root", name: "Halak", parentId: null },
        { id: "c-sub", name: "Tengeri halak", parentId: "c-root" },
      ],
    },
    productCategory: {
      findMany: async () => [{ productId: "os-live", categoryId: "c-sub" }],
    },
    productShippingProfile: {
      findMany: async () => [{ productId: "os-profile" }],
    },
    productVariant: { findMany: async () => [] },
    unasProductSnapshot: { findMany: async () => [] },
    product: {
      findMany: async () => [
        { id: "os-none", name: "Maradék" },
        { id: "os-live", name: "Élő" },
        { id: "os-profile", name: "Profilos" },
      ],
    },
  } as unknown as PickupAdoptionDatabase;
  const service = new MedusaPickupAdoptionService({
    shipping: async () => shipping,
    database,
  });
  return { service, jelolesek };
}

describe("a múltbeli átvétel szolgáltatása", () => {
  it("a lista besorol, számol, és semmit nem ír a boltba", async () => {
    const k = kornyezet();
    const lista = await k.service.list();
    assert.equal(lista.markKnown, true);
    assert.equal(lista.rows, 4);
    assert.equal(lista.marked, 1);
    assert.deepEqual(lista.counts, {
      none: 1,
      live: 1,
      profile: 1,
      unpaired: 0,
    });
    assert.deepEqual(
      lista.entries.map((e) => [
        e.osProductId,
        e.shopProductId,
        e.verdict,
        e.name,
      ]),
      [
        ["os-none", "shop-none", "none", "Maradék"],
        ["os-live", "shop-live", "live", "Élő"],
        ["os-profile", "shop-profile", "profile", "Profilos"],
      ],
    );
    assert.deepEqual(k.jelolesek, []);
  });

  it("az apply nélküli adopt terv (nem ír), az apply jelöl; az elgépelt és a nem adoptálható azonosítót megnevezi", async () => {
    const terv = kornyezet();
    const t = await terv.service.adopt(["os-none"], false);
    assert.equal(t.apply, false);
    assert.equal(t.adopted[0]?.action, "planned");
    assert.deepEqual(terv.jelolesek, [{ shop: "shop-none", apply: false }]);

    const ir = kornyezet();
    const r = await ir.service.adopt(
      ["os-none", "os-profile", "os-elirt"],
      true,
      "user-1",
    );
    assert.equal(r.apply, true);
    assert.deepEqual(
      r.adopted.map((a) => [a.osProductId, a.action]),
      [["os-none", "applied"]],
    );
    assert.deepEqual(
      r.refused.map((x) => x.id),
      ["os-profile", "os-elirt"],
    );
    assert.deepEqual(ir.jelolesek, [{ shop: "shop-none", apply: true }]);
  });

  it("a régi bolton (nincs jelölő mező) a lista jelzi, az adopt 409 és nem ír", async () => {
    const k = kornyezet(true);
    const lista = await k.service.list();
    assert.equal(lista.markKnown, false);
    assert.deepEqual(lista.entries, []);
    await assert.rejects(
      () => k.service.adopt(["os-none"], true),
      (e: unknown) =>
        e instanceof HttpException &&
        e.getStatus() === 409 &&
        e.message === "MEDUSA_PICKUP_MARK_UNKNOWN",
    );
    assert.deepEqual(k.jelolesek, []);
  });
});
