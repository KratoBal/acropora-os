import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { MedusaAdminClient } from "./medusa-admin.client.js";
import type {
  MedusaBrandRecord,
  OsBrandForShop,
} from "./medusa-brand-module.policy.js";
import {
  runBrandLinkCli,
  type BrandLinkCliDatabase,
} from "./medusa-brand-link.cli.js";

/*
  THE BRAND-LINK BACKFILL (kezdolap-marka-sav, 2026-10-27). What turns these
  red: a dry run that writes; a brand record written once per product instead
  of once per brand; a product with no shop counterpart written to, or not
  counted; a switched-off brand getting a record; the binding row not winning
  over the SKU pair; the summary not saying, per reason, what the run did; a
  write touching anything but the brand record and the product link.
*/
const marka = (
  id: string,
  over: Partial<OsBrandForShop> = {},
): OsBrandForShop => ({
  id,
  name: `Márka ${id}`,
  slug: `marka-${id}`,
  description: null,
  intro: null,
  seoTitle: null,
  metaDescription: null,
  logoUrl: null,
  websiteUrl: null,
  isActive: true,
  archivedAt: null,
  ...over,
});

function bolt(skus: Record<string, string>) {
  const brands: Record<string, MedusaBrandRecord> = {};
  const links: Record<string, string | null> = {};
  const irasok: string[] = [];
  const client = {
    listProductSkus: async (offset: number) => ({
      products:
        offset === 0
          ? Object.entries(skus).map(([id, sku]) => ({
              id,
              variants: [{ sku }],
            }))
          : [],
      count: Object.keys(skus).length,
    }),
    fetchBrand: async (id: string) => brands[id] ?? null,
    setBrand: async (id: string, record: MedusaBrandRecord) => {
      irasok.push(`brand ${id}`);
      brands[id] = record;
      return record;
    },
    fetchProductBrand: async (productId: string) => links[productId] ?? null,
    setProductBrand: async (productId: string, osBrandId: string | null) => {
      irasok.push(`link ${productId}=${osBrandId}`);
      links[productId] = osBrandId;
    },
  } as unknown as MedusaAdminClient;
  return { client, irasok, brands, links };
}

const adatbazis = (): BrandLinkCliDatabase => ({
  product: {
    findMany: async () => [
      { id: "os-1", brand: marka("b1") },
      { id: "os-2", brand: marka("b1") },
      { id: "os-3", brand: marka("b2", { isActive: false }) },
      { id: "os-4", brand: marka("b1") },
      { id: "os-5", brand: marka("b2", { isActive: false }) },
    ],
  },
  productVariant: {
    findMany: async () => [
      { sku: "SKU-1", productId: "os-1" },
      { sku: "SKU-2", productId: "os-2" },
      { sku: "SKU-3", productId: "os-3" },
      { sku: "SKU-4", productId: "os-4" },
      { sku: "SKU-5", productId: "os-5" },
    ],
  },
  unasProductSnapshot: { findMany: async () => [] },
});

function futtat(apply: boolean) {
  // os-4 has no shop product; os-2 has a binding row to another shop id than its SKU pair
  const shop = bolt({
    prod_1: "SKU-1",
    prod_2: "SKU-2",
    prod_3: "SKU-3",
    prod_5: "SKU-5",
  });
  const ki: string[] = [];
  const hibak: string[] = [];
  const kod = runBrandLinkCli(
    apply ? ["--apply"] : [],
    { stdout: (v) => ki.push(v), stderr: (v) => hibak.push(v) },
    undefined,
    adatbazis(),
    shop.client,
    { findManyByProductIds: async () => new Map([["os-2", "prod_kotes"]]) },
  );
  return { kod, shop, ki: () => ki.join(""), hibak };
}

describe("runBrandLinkCli", () => {
  it("a dry run writes nothing and counts every reason", async () => {
    const { kod, shop, ki } = futtat(false);
    assert.equal(await kod, 0);
    assert.deepEqual(shop.irasok, []);
    const kimenet = ki();
    assert.match(kimenet, /márkás OS termék: 5/);
    assert.match(kimenet, /a boltban nincs meg .*: 1/);
    assert.match(kimenet, /kikapcsolt vagy archivált márka .*: 2/);
    // os-1, os-2 get a link; os-3, os-5 already have none (their brand is off)
    assert.match(
      kimenet,
      /termék-márka kapcsolat: kiküldenénk 2, már így állt 2/,
    );
    assert.match(kimenet, /márka-rekord: kiküldenénk 1, már így állt 0/);
    assert.match(kimenet, /Ez a futás semmit nem írt/);
  });

  it("--apply writes the brand record once, the links, and nothing for the switched-off brand", async () => {
    const { kod, shop, ki, hibak } = futtat(true);
    assert.equal(await kod, 0);
    assert.deepEqual(hibak, []);
    assert.deepEqual(shop.irasok, [
      "brand b1",
      "link prod_1=b1",
      // the binding row wins over the SKU pair
      "link prod_kotes=b1",
    ]);
    assert.deepEqual(Object.keys(shop.brands), ["b1"]);
    assert.match(
      ki(),
      /termék-márka kapcsolat: most beállítva 2, már így állt 2/,
    );
    assert.match(ki(), /márka-rekord: most kiírva 1, már így állt 0/);
  });

  it("a second run finds everything as it is", async () => {
    const first = futtat(true);
    await first.kod;
    const ki: string[] = [];
    const kod = await runBrandLinkCli(
      ["--apply"],
      { stdout: (v) => ki.push(v), stderr: () => {} },
      undefined,
      adatbazis(),
      first.shop.client,
      { findManyByProductIds: async () => new Map([["os-2", "prod_kotes"]]) },
    );
    assert.equal(kod, 0);
    assert.equal(first.shop.irasok.length, 3);
    assert.match(ki.join(""), /most beállítva 0, már így állt 4/);
    assert.match(ki.join(""), /márka-rekord: most kiírva 0, már így állt 1/);
  });
});
