import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { main } from "./store-category-load.cli.js";

/**
 * A BETÖLTŐ PARANCSA (SEO P0 PR 10). Az adatbázis egy hamis kliens, amelyik csak
 * olvasni tud, és megszámolja, hányszor kértek tranzakciót: a száraz futás és az
 * ütközéses terv egyszer sem kérhet.
 */
function hamisDb() {
  const state = { transactions: 0 };
  const ures = async () => [];
  const db = {
    storeCategory: { findMany: ures },
    slugHistory: { findMany: ures },
    productVariant: {
      findMany: async () => [{ sku: "AF-1", productId: "p1" }],
    },
    category: { findMany: async () => [{ id: "u1" }] },
    unasCategoryMapping: { findMany: ures },
    storeCategoryProduct: { findMany: ures },
    $transaction: async () => {
      state.transactions++;
      return { redirects: 0 };
    },
  };
  return { db: db as never, state };
}

function futtat(args: string[], content: string) {
  const { db, state } = hamisDb();
  const out = { stdout: "", stderr: "" };
  return main(
    args,
    {
      stdout: (v) => (out.stdout += v),
      stderr: (v) => (out.stderr += v),
    },
    db,
    async () => content,
  ).then((code) => ({ code, out, state }));
}

const JO = JSON.stringify({
  categories: [{ slug: "vilagitas", name: "Világítás" }],
  products: [{ sku: "AF-1", categories: ["vilagitas"], primary: "vilagitas" }],
  unasMappings: [{ unasCategoryId: "u1", storeCategory: "vilagitas" }],
});

describe("a kategóriafa betöltőjének parancsa", () => {
  it("alapból száraz: kiírja a tervet, és nem kér tranzakciót", async () => {
    const r = await futtat(["fa.json"], JO);
    assert.equal(r.code, 0);
    assert.equal(r.state.transactions, 0);
    assert.match(r.out.stdout, /KATEGÓRIA: 1 új/);
    assert.match(r.out.stdout, /SZARAZFUTAS: semmi nem irodott/);
  });

  it("--apply mellett egy tranzakcióban alkalmaz", async () => {
    const r = await futtat(["fa.json", "--apply"], JO);
    assert.equal(r.code, 0);
    assert.equal(r.state.transactions, 1);
    assert.match(r.out.stdout, /ALKALMAZVA: 1 új/);
  });

  it("ütközéses tervnél --apply mellett sem ír, és 2-vel lép ki", async () => {
    const r = await futtat(
      ["fa.json", "--apply"],
      JSON.stringify({
        categories: [{ slug: "a", name: "a", parent: "nincs" }],
      }),
    );
    assert.equal(r.code, 2);
    assert.equal(r.state.transactions, 0);
    assert.match(r.out.stdout, /a terv NEM alkalmazható/);
  });

  it("rossz alakú fájlnál nem kérdezi meg az adatbázist", async () => {
    const r = await futtat(["fa.json"], JSON.stringify({ categories: "x" }));
    assert.equal(r.code, 1);
    assert.match(r.out.stderr, /"categories": nem lista/);
  });
});
