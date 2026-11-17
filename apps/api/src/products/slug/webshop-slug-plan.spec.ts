import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PERMISSIONS } from "@acropora/types";

import { REQUIRED_PERMISSIONS_KEY } from "../../auth/decorators/require-permissions.decorator.js";
import { main } from "./slug-backfill.cli.js";
import { WebshopSlugPlanController } from "./webshop-slug-plan.controller.js";
import { WebshopSlugPlanService } from "./webshop-slug-plan.service.js";

/*
  THE READ-ONLY WEBSHOP SLUG PLAN (card f6cb0a51 (d): 13 products have no webshop slug, and on the stage the Coolify one-off job
  returns only success or failed, so the output of the dry run cannot be seen).
  WHAT TURNS IT RED: if the read path writes (the fake database throws on every write call); if it returns another plan than the
  slug-backfill command on the same data (the list and the --apply would be two pieces of code); if a product that already has a slug
  is listed; if on a clash it does not show the suggested slug and the kind of the clash; if the endpoint does not ask for
  PRODUCTS_VIEW or is not a GET.
*/
interface FakeProduct {
  id: string;
  name: string;
  sku: string | null;
  slug: string | null;
}

function fakeDb(products: FakeProduct[], history: string[] = []) {
  const reads: string[] = [];
  const refuse = (name: string) => () => {
    throw new Error(`the read-only plan must not call ${name}`);
  };
  return {
    reads,
    db: {
      product: {
        findMany: async () => {
          reads.push("product");
          return products.map((p) => ({
            id: p.id,
            name: p.name,
            variants: p.sku ? [{ sku: p.sku }] : [],
            channelListings: p.slug ? [{ slug: p.slug }] : [],
          }));
        },
        create: refuse("product.create"),
        update: refuse("product.update"),
        upsert: refuse("product.upsert"),
      },
      slugHistory: {
        findMany: async () => {
          reads.push("slugHistory");
          return history.map((slug) => ({ slug }));
        },
        create: refuse("slugHistory.create"),
      },
      channelListing: {
        upsert: refuse("channelListing.upsert"),
        create: refuse("channelListing.create"),
        update: refuse("channelListing.update"),
      },
      $transaction: refuse("$transaction"),
    },
  };
}

describe("the webshop slug plan read path", () => {
  it("lists a product without a slug with its suggested slug, and not one that has a slug", async () => {
    const { db } = fakeDb([
      { id: "p1", name: "Straton X lampa", sku: "stratonx", slug: null },
      { id: "p2", name: "Mar kesz", sku: "kesz1", slug: "mar-kesz" },
    ]);
    const view = await new WebshopSlugPlanService(db as never).plan();
    assert.deepEqual(view.rows, [
      {
        productId: "p1",
        name: "Straton X lampa",
        sku: "stratonx",
        slug: "straton-x-lampa",
        clash: "none",
      },
    ]);
    assert.equal(view.counts.missing, 1);
    assert.equal(view.counts.alreadySlugged, 1);
  });

  it("names the kind of a clash: sku suffix, then a number; an old (SlugHistory) slug is taken too", async () => {
    const { db } = fakeDb(
      [
        { id: "p1", name: "Pumpa", sku: "A1", slug: "pumpa" },
        { id: "p2", name: "Pumpa", sku: "B2", slug: null },
        { id: "p3", name: "Regi", sku: "C3", slug: null },
        { id: "p4", name: "Pumpa", sku: "B2", slug: null },
      ],
      ["regi"],
    );
    const view = await new WebshopSlugPlanService(db as never).plan();
    const byId = Object.fromEntries(view.rows.map((r) => [r.productId, r]));
    assert.deepEqual([byId.p2!.slug, byId.p2!.clash], ["pumpa-b2", "sku"]);
    assert.deepEqual([byId.p3!.slug, byId.p3!.clash], ["regi-c3", "sku"]);
    assert.deepEqual([byId.p4!.slug, byId.p4!.clash], ["pumpa-b2-2", "number"]);
  });

  it("a product without an active variant: the sku is null, the suggested slug comes from the name", async () => {
    const { db } = fakeDb([
      { id: "p1", name: "Csak nev", sku: null, slug: null },
    ]);
    const view = await new WebshopSlugPlanService(db as never).plan();
    assert.equal(view.rows[0]!.sku, null);
    assert.equal(view.rows[0]!.slug, "csak-nev");
  });

  it("reads only: the fake database throws on every write call, and both reads happened", async () => {
    const { db, reads } = fakeDb([
      { id: "p1", name: "Egy", sku: "e1", slug: null },
    ]);
    await new WebshopSlugPlanService(db as never).plan();
    assert.deepEqual(reads, ["product", "slugHistory"]);
  });

  it("gives the SAME plan as the slug-backfill command's dry run on the same data", async () => {
    const products: FakeProduct[] = [
      { id: "p1", name: "Pumpa", sku: "A1", slug: "pumpa" },
      { id: "p2", name: "Pumpa", sku: "B2", slug: null },
      { id: "p3", name: "Uj", sku: "C3", slug: null },
    ];
    const { db } = fakeDb(products, ["x"]);
    const view = await new WebshopSlugPlanService(db as never).plan();
    let out = "";
    const code = await main(
      [],
      { stdout: (v) => (out += v), stderr: () => {} },
      db as never,
    );
    assert.equal(code, 0);
    assert.match(view.summary, /Uj webshop-slug: 2 termek/);
    assert.ok(
      out.startsWith(view.summary),
      "the CLI dry run prints the very summary the endpoint returns",
    );
    assert.equal(view.rows.length, 2);
  });

  it("the endpoint is a GET behind PRODUCTS_VIEW, with no write handler beside it", () => {
    const handler = WebshopSlugPlanController.prototype.plan;
    assert.deepEqual(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, handler), [
      PERMISSIONS.PRODUCTS_VIEW,
    ]);
    assert.equal(Reflect.getMetadata("method", handler), 0); // RequestMethod.GET
    assert.deepEqual(
      Object.getOwnPropertyNames(WebshopSlugPlanController.prototype).sort(),
      ["constructor", "plan"],
    );
  });
});
