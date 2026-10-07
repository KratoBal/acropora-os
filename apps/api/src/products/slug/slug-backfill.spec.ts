import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { main } from "./slug-backfill.cli.js";
import { planSlugBackfill } from "./slug-backfill.js";

/**
 * A SLUG-BACKFILL (SEO P0 PR 5; D1). MI PIROSIT: ütközésnél nem a régebbi termék
 * kapja a sima slugot; egy már sluggal bíró termék új slugot kap; egy régi
 * (`SlugHistory`) slug kiosztódik; a szárazfutás ír; egy második futás ír.
 */
const t = (
  id: string,
  name: string,
  sku: string | null,
  slug: string | null = null,
) => ({
  id,
  name,
  primarySku: sku,
  slug,
});

describe("planSlugBackfill", () => {
  it("D1: a régebbi (kisebb azonosítójú) kapja a sima slugot, a sorrendtől függetlenül", () => {
    const plan = planSlugBackfill(
      [t("c2", "Pumpa", "B-2"), t("c1", "Pumpa", "A 1")],
      [],
    );
    assert.deepEqual(plan.assignments, [
      { productId: "c1", slug: "pumpa" },
      { productId: "c2", slug: "pumpa-b-2" },
    ]);
    assert.deepEqual(plan.skuSuffix, [{ productId: "c2", slug: "pumpa-b-2" }]);
  });

  it("a meglévő slug és a régi slug foglalt; a sluggal bíró termék kimarad", () => {
    const plan = planSlugBackfill(
      [
        t("c1", "Pumpa", "A1", "pumpa"),
        t("c2", "Szuro", "B1"),
        t("c3", "Pumpa", "C1"),
      ],
      ["szuro"],
    );
    assert.deepEqual(plan.assignments, [
      { productId: "c2", slug: "szuro-b1" },
      { productId: "c3", slug: "pumpa-c1" },
    ]);
    assert.equal(plan.alreadySlugged, 1);
  });

  it("számolja a vágottat és az üres nevet", () => {
    const plan = planSlugBackfill(
      [t("c1", "x".repeat(90), "A1"), t("c2", "–", "B 2")],
      [],
    );
    assert.equal(plan.truncated, 1);
    assert.equal(plan.emptyName, 1);
    assert.equal(plan.assignments[1]!.slug, "termek-b-2");
  });
});

describe("a slug-backfill parancs", () => {
  function adatbazis(webshop: string | null = null) {
    const irasok: unknown[] = [];
    return {
      irasok,
      db: {
        product: {
          findMany: async () => [
            {
              id: "c1",
              name: "Pumpa",
              variants: [{ sku: "A1" }],
              channelListings: webshop ? [{ slug: webshop }] : [],
            },
          ],
        },
        slugHistory: { findMany: async () => [] },
        channelListing: {
          upsert: (args: unknown) => (irasok.push(args), args),
        },
        $transaction: async (ops: unknown[]) => {
          irasok.push(["transaction", ops.length]);
          return ops;
        },
      },
    };
  }
  const csend = { stdout: () => {}, stderr: () => {} };

  it("alapból szárazfutás: nem ír", async () => {
    const { db, irasok } = adatbazis();
    assert.equal(await main([], csend, db as never), 0);
    assert.deepEqual(irasok, []);
  });

  it("--apply egy tranzakcióban a WEBSHOP-sort írja", async () => {
    const { db, irasok } = adatbazis();
    assert.equal(await main(["--apply"], csend, db as never), 0);
    assert.deepEqual(irasok, [
      {
        where: { productId_channel: { productId: "c1", channel: "WEBSHOP" } },
        create: { productId: "c1", channel: "WEBSHOP", slug: "pumpa" },
        update: { slug: "pumpa" },
      },
      ["transaction", 1],
    ]);
  });

  it("egy második futás (már van slug) nem ír új sort", async () => {
    const { db, irasok } = adatbazis("pumpa");
    assert.equal(await main(["--apply"], csend, db as never), 0);
    assert.deepEqual(irasok, [["transaction", 0]]);
  });

  it("ismeretlen kapcsolóra nem fut", async () => {
    const { db, irasok } = adatbazis();
    assert.equal(await main(["--aply"], csend, db as never), 1);
    assert.deepEqual(irasok, []);
  });
});
