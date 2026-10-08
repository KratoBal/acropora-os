import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  describeStoreCategoryLoad,
  parseStoreCategoryFile,
  planStoreCategoryLoad,
  type ExistingStoreCategory,
  type StoreCategoryFile,
  type StoreCategoryState,
} from "./store-category-load.js";

/**
 * AZ ACROPORA-KATEGÓRIAFA BETÖLTÉSÉNEK TERVE (SEO P0 PR 10). Adatbázis nélkül:
 * a fájl és a mai állapot megy be, a terv jön ki.
 */
const meglevo = (
  id: string,
  slug: string,
  over: Partial<ExistingStoreCategory> = {},
): ExistingStoreCategory => ({
  id,
  slug,
  name: slug,
  parentId: null,
  seoTitle: null,
  metaDescription: null,
  intro: null,
  imageUrl: null,
  sortOrder: 0,
  isActive: true,
  ...over,
});

const allapot = (
  over: Partial<StoreCategoryState> = {},
): StoreCategoryState => ({
  categories: [],
  slugHistory: [],
  productIdBySku: new Map([
    ["AF-1", "p1"],
    ["AF-2", "p2"],
  ]),
  assignments: [],
  unasCategoryIds: new Set(["u1"]),
  mappings: [],
  ...over,
});

const fajl = (over: Partial<StoreCategoryFile> = {}): StoreCategoryFile => ({
  categories: [],
  products: [],
  unasMappings: [],
  ...over,
});

describe("a kategóriafa betöltésének terve (SEO P0 PR 10)", () => {
  it("új fa: a szülő előbb jön létre, akkor is, ha a fájlban a gyerek áll elöl", () => {
    const plan = planStoreCategoryLoad(
      fajl({
        categories: [
          { slug: "led-lampak", name: "LED lámpák", parent: "vilagitas" },
          { slug: "vilagitas", name: "Világítás" },
        ],
      }),
      allapot(),
    );
    assert.deepEqual(plan.conflicts, []);
    assert.deepEqual(
      plan.create.map((c) => c.slug),
      ["vilagitas", "led-lampak"],
    );
    assert.deepEqual(plan.create[1]!.parent, { newSlug: "vilagitas" });
    assert.equal(plan.create[0]!.fields.name, "Világítás");
  });

  it("ugyanaz a fájl a betöltés után: nulla változás", () => {
    const plan = planStoreCategoryLoad(
      fajl({
        categories: [
          { slug: "vilagitas", name: "Világítás" },
          { slug: "led-lampak", name: "LED lámpák", parent: "vilagitas" },
        ],
        products: [
          {
            sku: "AF-1",
            categories: ["led-lampak", "vilagitas"],
            primary: "led-lampak",
          },
        ],
        unasMappings: [{ unasCategoryId: "u1", storeCategory: "vilagitas" }],
      }),
      allapot({
        categories: [
          meglevo("c1", "vilagitas", { name: "Világítás" }),
          meglevo("c2", "led-lampak", { name: "LED lámpák", parentId: "c1" }),
        ],
        assignments: [
          { productId: "p1", storeCategoryId: "c2", isPrimary: true },
          { productId: "p1", storeCategoryId: "c1", isPrimary: false },
        ],
        mappings: [{ unasCategoryId: "u1", storeCategoryId: "c1", note: null }],
      }),
    );
    assert.deepEqual(plan, {
      create: [],
      update: [],
      slugChange: [],
      products: [],
      mappings: [],
      conflicts: [],
    });
  });

  it("egy meglévő kategória mezői és szülője frissül, a változás régi és új értékkel", () => {
    const plan = planStoreCategoryLoad(
      fajl({
        categories: [
          {
            slug: "pumpak",
            name: "Pumpák",
            seoTitle: "Akvárium pumpák",
            parent: "technika",
          },
        ],
      }),
      allapot({
        categories: [
          meglevo("c1", "pumpak", { name: "Pumpa" }),
          meglevo("c9", "technika"),
        ],
      }),
    );
    assert.deepEqual(plan.conflicts, []);
    assert.equal(plan.update.length, 1);
    assert.deepEqual(plan.update[0]!.data, {
      name: "Pumpák",
      seoTitle: "Akvárium pumpák",
    });
    assert.deepEqual(plan.update[0]!.changes.parent, {
      from: null,
      to: "id:c9",
    });
    assert.deepEqual(plan.update[0]!.parent, { id: "c9" });
  });

  it("slugcsere azonosító szerint, és a saját régi slug visszavehető", () => {
    const plan = planStoreCategoryLoad(
      fajl({
        categories: [{ id: "c1", slug: "vilagitas", name: "vilagitas" }],
      }),
      allapot({
        categories: [meglevo("c1", "lampak", { name: "vilagitas" })],
        slugHistory: [{ slug: "vilagitas", entityId: "c1" }],
      }),
    );
    assert.deepEqual(plan.conflicts, []);
    assert.deepEqual(plan.slugChange, [
      { id: "c1", from: "lampak", to: "vilagitas", reclaimsOwnHistory: true },
    ]);
  });

  it("a termék besorolása pontosan a felsorolt lesz, az üres lista kivesz, a sorrend is változás", () => {
    const state = allapot({
      categories: [meglevo("c1", "a"), meglevo("c2", "b")],
      assignments: [
        { productId: "p1", storeCategoryId: "c1", isPrimary: true },
        { productId: "p1", storeCategoryId: "c2", isPrimary: false },
        { productId: "p2", storeCategoryId: "c1", isPrimary: true },
      ],
    });
    const plan = planStoreCategoryLoad(
      fajl({
        products: [
          { sku: "AF-1", categories: ["b", "a"], primary: "a" },
          { sku: "AF-2", categories: [] },
        ],
      }),
      state,
    );
    assert.deepEqual(plan.conflicts, []);
    assert.deepEqual(
      plan.products.map((p) => [
        p.sku,
        p.rows.map((r) => [r.slug, r.isPrimary]),
      ]),
      [
        [
          "AF-1",
          [
            ["b", false],
            ["a", true],
          ],
        ],
        ["AF-2", []],
      ],
    );
  });

  it("a UNAS-leképezés csak változásnál kerül a tervbe, a pár nélküli sor a megjegyzéssel", () => {
    const plan = planStoreCategoryLoad(
      fajl({
        unasMappings: [
          { unasCategoryId: "u1", storeCategory: null, note: "kivezetett ág" },
        ],
      }),
      allapot({
        mappings: [{ unasCategoryId: "u1", storeCategoryId: "c1", note: null }],
      }),
    );
    assert.deepEqual(plan.conflicts, []);
    assert.deepEqual(plan.mappings, [
      {
        unasCategoryId: "u1",
        storeCategory: null,
        storeCategorySlug: null,
        note: "kivezetett ág",
      },
    ]);
  });

  describe("ütközés: a terv nem alkalmazható, és megnevezi az okot", () => {
    const egy = (file: StoreCategoryFile, state = allapot()) =>
      planStoreCategoryLoad(file, state).conflicts;

    it("rossz alakú és kétszer szereplő slug", () => {
      const c = egy(
        fajl({
          categories: [
            { slug: "Világítás", name: "x" },
            { slug: "a", name: "a" },
            { slug: "a", name: "b" },
          ],
        }),
      );
      assert.ok(c.some((x) => x.includes('"Világítás": a slug csak')));
      assert.ok(c.some((x) => x.includes('"a": kétszer szerepel a fájlban')));
    });

    it("egy másik kategória élő slugja", () => {
      const c = egy(
        fajl({ categories: [{ id: "c2", slug: "a", name: "a" }] }),
        allapot({ categories: [meglevo("c1", "a"), meglevo("c2", "b")] }),
      );
      assert.ok(
        c.some((x) => x.includes("egy másik kategóriáé (c1)")),
        c.join("\n"),
      );
    });

    it("egy másik kategória régi slugja (SlugHistory)", () => {
      const c = egy(
        fajl({ categories: [{ slug: "regi", name: "x" }] }),
        allapot({ slugHistory: [{ slug: "regi", entityId: "c7" }] }),
      );
      assert.ok(c.some((x) => x.includes("a(z) c7 kategóriáé volt")));
    });

    it("egy elhagyott slug új gazdát kapna ugyanabban a fájlban", () => {
      const c = egy(
        fajl({
          categories: [
            { id: "c1", slug: "uj-nev", name: "x" },
            { id: "c2", slug: "regi", name: "y" },
          ],
        }),
        allapot({
          categories: [meglevo("c1", "regi"), meglevo("c2", "masik")],
        }),
      );
      assert.ok(
        c.some((x) => x.includes("régi címe lenne")),
        c.join("\n"),
      );
    });

    it("ismeretlen szülő és kör a szülő-láncban", () => {
      assert.ok(
        egy(
          fajl({ categories: [{ slug: "a", name: "a", parent: "nincs" }] }),
        ).some((x) => x.includes('nincs "nincs" slugú kategória')),
      );
      assert.ok(
        egy(
          fajl({
            categories: [
              { slug: "a", name: "a", parent: "b" },
              { slug: "b", name: "b", parent: "a" },
            ],
          }),
        ).some((x) => x.startsWith("kör a szülő-láncban")),
      );
    });

    it("ismeretlen cikkszám, hiányzó és idegen primary, ismeretlen UNAS-kategória", () => {
      const c = egy(
        fajl({
          categories: [
            { slug: "a", name: "a" },
            { slug: "b", name: "b" },
          ],
          products: [
            { sku: "NINCS", categories: ["a"], primary: "a" },
            { sku: "AF-1", categories: ["a", "b"] },
            { sku: "AF-2", categories: ["a"], primary: "b" },
          ],
          unasMappings: [{ unasCategoryId: "u404", storeCategory: "a" }],
        }),
      );
      assert.ok(
        c.some((x) => x.includes('"NINCS": nincs ilyen cikkszámú termék')),
      );
      assert.ok(c.some((x) => x.includes('"AF-1": nincs megadva primary')));
      assert.ok(c.some((x) => x.includes('"AF-2": a primary ("b") nincs')));
      assert.ok(
        c.some((x) => x.includes('"u404": nincs ilyen UNAS-kategória')),
      );
    });

    it("a leírás kimondja, hogy a terv nem alkalmazható", () => {
      const plan = planStoreCategoryLoad(
        fajl({ categories: [{ slug: "a", name: "a", parent: "nincs" }] }),
        allapot(),
      );
      assert.match(
        describeStoreCategoryLoad(plan),
        /ÜTKÖZÉS: 1, a terv NEM alkalmazható/,
      );
    });
  });

  it("a fájl alakját a terv előtt ellenőrzi", () => {
    const r = parseStoreCategoryFile({
      categories: [{ slug: 1 }],
      products: [{ sku: "x", categories: "a" }],
    });
    assert.equal(r.ok, false);
    assert.deepEqual(!r.ok && r.errors, [
      "categories[0].slug: nem szöveg",
      "categories[0].name: hiányzik",
      "products[0].categories: nem szöveg-lista",
    ]);
  });
});
