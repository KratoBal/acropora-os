import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { MedusaAdminClient } from "./medusa-admin.client.js";
import {
  brandIsShown,
  brandRecord,
  brandRecordDiffers,
  type MedusaBrandRecord,
  type OsBrandForShop,
} from "./medusa-brand-module.policy.js";
import {
  describeBrandLink,
  MedusaBrandModuleService,
} from "./medusa-brand-module.service.js";

const marka = (over: Partial<OsBrandForShop> = {}): OsBrandForShop => ({
  id: "brand-1",
  name: "Aquaforest",
  slug: "aquaforest",
  description: "Leírás.",
  intro: "Bevezető.",
  seoTitle: null,
  metaDescription: "  ",
  logoUrl: null,
  websiteUrl: null,
  isActive: true,
  archivedAt: null,
  ...over,
});

/**
 * A bolt duplaja: a marka-rekordokat es a termek-kapcsolatokat tarolja, es
 * minden hivast felir. Csak a negy marka-metodus el; mas hivas hibat dob.
 */
function bolt(
  kezdo: {
    brands?: Record<string, MedusaBrandRecord>;
    links?: Record<string, string | null>;
  } = {},
) {
  const brands = { ...(kezdo.brands ?? {}) };
  const links = { ...(kezdo.links ?? {}) };
  const hivasok: string[] = [];
  const client = {
    fetchBrand: async (id: string) => {
      hivasok.push(`GET brand ${id}`);
      return brands[id] ?? null;
    },
    setBrand: async (id: string, record: MedusaBrandRecord) => {
      hivasok.push(`PUT brand ${id}`);
      brands[id] = record;
      return record;
    },
    fetchProductBrand: async (productId: string) => {
      hivasok.push(`GET link ${productId}`);
      return links[productId] ?? null;
    },
    setProductBrand: async (productId: string, osBrandId: string | null) => {
      hivasok.push(`PUT link ${productId}=${osBrandId}`);
      links[productId] = osBrandId;
    },
  } as unknown as MedusaAdminClient;
  return { client, hivasok, brands, links };
}

describe("brandRecord", () => {
  it("a slug a handle, es az ures szoveg null", () => {
    assert.deepEqual(brandRecord(marka()), {
      name: "Aquaforest",
      handle: "aquaforest",
      description: "Leírás.",
      intro: "Bevezető.",
      seo_title: null,
      meta_description: null,
      logo_url: null,
      website_url: null,
    });
  });

  it("a kikapcsolt vagy archivalt marka nem kap boltoldalt", () => {
    assert.equal(brandIsShown(marka()), true);
    assert.equal(brandIsShown(marka({ isActive: false })), false);
    assert.equal(brandIsShown(marka({ archivedAt: new Date() })), false);
    assert.equal(brandIsShown(null), false);
  });

  it("egy hianyzo vagy eltero mezo kulonbseg, az azonos rekord nem", () => {
    const wanted = brandRecord(marka());
    assert.equal(brandRecordDiffers(null, wanted), true);
    assert.equal(brandRecordDiffers({ ...wanted }, wanted), false);
    assert.equal(
      brandRecordDiffers({ ...wanted, seo_title: "Más" }, wanted),
      true,
    );
    const { intro: _, ...hianyos } = wanted;
    assert.equal(brandRecordDiffers(hianyos, wanted), true);
  });
});

describe("MedusaBrandModuleService", () => {
  it("elso termeknel a rekordot es a kapcsolatot is kiirja, a masodiknal a rekordot mar nem nezi", async () => {
    const { client, hivasok, links } = bolt();
    const service = new MedusaBrandModuleService(client);

    const elso = await service.project("prod_a", marka());
    const masodik = await service.project("prod_b", marka());

    assert.deepEqual(hivasok, [
      "GET brand brand-1",
      "PUT brand brand-1",
      "GET link prod_a",
      "PUT link prod_a=brand-1",
      "GET link prod_b",
      "PUT link prod_b=brand-1",
    ]);
    assert.deepEqual(
      [elso.brandRecord, masodik.brandRecord],
      ["applied", "cached"],
    );
    assert.deepEqual(links, { prod_a: "brand-1", prod_b: "brand-1" });
  });

  it("ami mar igy allt, ahhoz nem ir", async () => {
    const { client, hivasok } = bolt({
      brands: { "brand-1": brandRecord(marka()) },
      links: { prod_a: "brand-1" },
    });
    const kimenet = await new MedusaBrandModuleService(client).project(
      "prod_a",
      marka(),
    );
    assert.deepEqual(hivasok, ["GET brand brand-1", "GET link prod_a"]);
    assert.deepEqual(kimenet, {
      action: "unchanged",
      osBrandId: "brand-1",
      brandRecord: "unchanged",
    });
  });

  it("marka nelkul, vagy archivalt markaval a kapcsolat torlodik, a rekordhoz nem nyul", async () => {
    const { client, hivasok, links } = bolt({
      links: { prod_a: "brand-1", prod_b: "brand-1" },
    });
    const service = new MedusaBrandModuleService(client);
    await service.project("prod_a", null);
    await service.project("prod_b", marka({ isActive: false }));
    assert.deepEqual(hivasok, [
      "GET link prod_a",
      "PUT link prod_a=null",
      "GET link prod_b",
      "PUT link prod_b=null",
    ]);
    assert.deepEqual(links, { prod_a: null, prod_b: null });
  });

  it("a marka nelkuli, valtozatlan termek egyetlen irast sem kuld", async () => {
    const { client, hivasok } = bolt();
    const kimenet = await new MedusaBrandModuleService(client).project(
      "prod_a",
      null,
    );
    assert.deepEqual(hivasok, ["GET link prod_a"]);
    assert.equal(kimenet.action, "unchanged");
  });

  it("a kimeneti sor megmondja, mi tortent", () => {
    assert.equal(
      describeBrandLink({
        action: "applied",
        osBrandId: "brand-1",
        brandRecord: "applied",
      }),
      "      márka-kapcsolat: most állítottuk be (márka brand-1, a márka adatai most kerültek ki)\n",
    );
    assert.equal(
      describeBrandLink({
        action: "applied",
        osBrandId: null,
        brandRecord: "none",
      }),
      "      márka-kapcsolat: most állítottuk be (márka nélkül)\n",
    );
  });
});
