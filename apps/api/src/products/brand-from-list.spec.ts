import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BRAND_LIST_MAX_ITEMS,
  BrandListInputError,
  describeBrandListPlan,
  parseBrandListInput,
  planBrandList,
  type ListBrand,
  type ListProduct,
} from "./brand-from-list.js";
import {
  runBrandFromListAction,
  type BrandFromListDependencies,
} from "./brand-from-list.run.js";

/**
 * THE BRAND FROM AN EXPLICIT LIST (catalog action `brand-from-list`; card 16d06aea, acrobot 52178). WHAT TURNS IT RED: a
 * product with a brand written over; a product that is not on the list touched; the shop's own brand ("Acropora") assigned
 * or created, by id, by name or through an alias; a new brand name that already is a brand (or an alias) created a second
 * time; one new brand created twice for two products; a bad item that does not stop the whole run; the plan writing; the
 * write without a named actor; a product that got a brand in the meantime overwritten; a list with a product twice, an
 * unknown field, both or neither of brandId and newBrandName. Invented names and ids only.
 */
const brand = (
  id: string,
  name: string,
  extra: Partial<ListBrand> = {},
): ListBrand => ({
  id,
  name,
  normalizedName: name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim(),
  isActive: true,
  normalizedAliases: [],
  ...extra,
});
const BRANDS: ListBrand[] = [
  brand("b-eco", "Ecotech"),
  brand("b-own", "Acropora"),
  brand("b-off", "Régi Márka", { isActive: false }),
  brand("b-jb", "Jebao", { normalizedAliases: ["jecod"] }),
  brand("b-x1", "Twin One", { normalizedAliases: ["twin"] }),
  brand("b-x2", "Twin Two", { normalizedAliases: ["twin"] }),
];
const PRODUCTS: ListProduct[] = [
  { id: "p1", name: "Radion XR30", brandId: null },
  { id: "p2", name: "Radion XR15", brandId: null },
  { id: "p3", name: "Más termék", brandId: "b-jb" },
  { id: "p4", name: "Egy komplex", brandId: null },
  { id: "p5", name: "Másik komplex", brandId: null },
];

describe("a lista beolvasása", () => {
  it("elfogad egy létező márkát vagy egy új nevet, és szűri a szóközöket", () => {
    const input = parseBrandListInput({
      items: [
        { productId: " p1 ", brandId: "b-eco" },
        { productId: "p2", newBrandName: "  Új Márka " },
      ],
    });
    assert.deepEqual(input.items, [
      { productId: "p1", brandId: "b-eco" },
      { productId: "p2", newBrandName: "Új Márka" },
    ]);
  });

  it("megáll: üres lista, nem tömb, ismeretlen mező, mindkettő vagy egyik sem, kétszer ugyanaz a termék", () => {
    const bad = (body: unknown, part: string) =>
      assert.throws(
        () => parseBrandListInput(body),
        (error: unknown) =>
          error instanceof BrandListInputError && error.message.includes(part),
      );
    bad(undefined, "legalább egy tétellel");
    bad({ items: [] }, "legalább egy tétellel");
    bad({ items: "p1" }, "legalább egy tétellel");
    bad(
      { items: [{ productId: "p1", brandId: "b", extra: 1 }] },
      "ismeretlen mező van: extra",
    );
    bad({ items: [{ productId: "p1" }] }, "pontosan az egyik kell");
    bad(
      { items: [{ productId: "p1", brandId: "b", newBrandName: "X" }] },
      "pontosan az egyik kell",
    );
    bad({ items: [{ brandId: "b" }] }, "hiányzik: productId");
    bad({ items: [null] }, "nem objektum");
    bad(
      {
        items: [
          { productId: "p1", brandId: "b" },
          { productId: "p1", brandId: "c" },
        ],
      },
      "2. tétel terméke (p1) már szerepel",
    );
  });

  it("a lista hossza korlátos", () => {
    const items = Array.from({ length: BRAND_LIST_MAX_ITEMS + 1 }, (_, i) => ({
      productId: `p${i}`,
      brandId: "b",
    }));
    assert.throws(() => parseBrandListInput({ items }), BrandListInputError);
  });
});

describe("a terv: a lista a meglévőhöz mérve", () => {
  const plan = (items: unknown[]) =>
    planBrandList(parseBrandListInput({ items }), PRODUCTS, BRANDS);

  it("létező márka azonosítóval; a már márkás termék kimarad", () => {
    const result = plan([
      { productId: "p1", brandId: "b-eco" },
      { productId: "p3", brandId: "b-eco" },
    ]);
    assert.deepEqual(
      result.rows.map((r) => r.kind),
      ["ASSIGN", "HAS_BRAND"],
    );
    const has = result.rows[1]!;
    assert.equal(has.kind === "HAS_BRAND" && has.brandName, "Jebao");
  });

  it("egy új név, ami már márka vagy alias, azt a márkát találja meg, nem hoz létre újat", () => {
    const result = plan([
      { productId: "p1", newBrandName: "ECOTECH" },
      { productId: "p2", newBrandName: "Jecod" },
    ]);
    assert.equal(result.newBrands.length, 0);
    assert.deepEqual(
      result.rows.map((r) =>
        r.kind === "ASSIGN" ? [r.brandId, r.via] : r.kind,
      ),
      [
        ["b-eco", "found"],
        ["b-jb", "found"],
      ],
    );
  });

  it("egy új márka egyszer jön létre, akárhány terméknek, akárhogy írták", () => {
    const result = plan([
      { productId: "p1", newBrandName: "Aqua Connect" },
      { productId: "p2", newBrandName: "AQUA-CONNECT" },
    ]);
    assert.equal(result.newBrands.length, 1);
    assert.equal(result.newBrands[0]!.name, "Aqua Connect");
    assert.deepEqual(
      result.rows.map((r) => r.kind),
      ["ASSIGN_NEW", "ASSIGN_NEW"],
    );
  });

  it("az Acropora saját márka: azonosítóval, névvel és más írásmóddal is hiba", () => {
    const result = plan([
      { productId: "p1", brandId: "b-own" },
      { productId: "p2", newBrandName: "acropora" },
      { productId: "p4", newBrandName: "ACROPORA!" },
    ]);
    assert.deepEqual(
      result.rows.map((r) => r.kind),
      ["ERROR", "ERROR", "ERROR"],
    );
    assert.equal(result.newBrands.length, 0);
    assert.ok(
      result.rows.every(
        (r) => r.kind === "ERROR" && r.reason.includes("saját márkája"),
      ),
    );
  });

  it("hiba: ismeretlen termék, ismeretlen vagy inaktív márka, két márkához illő név, üres név", () => {
    const reasons = plan([
      { productId: "nincs", brandId: "b-eco" },
      { productId: "p1", brandId: "b-nincs" },
      { productId: "p2", brandId: "b-off" },
      { productId: "p4", newBrandName: "Twin" },
      { productId: "p5", newBrandName: "---" },
    ]).rows.map((r) => (r.kind === "ERROR" ? r.reason : r.kind));
    assert.deepEqual(reasons, [
      "nincs ilyen termék",
      "nincs ilyen márka: b-nincs",
      "a márka nem aktív: Régi Márka",
      "a név két márkához illik: Twin One | Twin Two",
      "a márka neve nem tartalmaz betűt vagy számot",
    ]);
  });

  it("a kimenet tételes, és a hibás tétel látszik", () => {
    const text = describeBrandListPlan(
      plan([
        { productId: "p1", newBrandName: "Aqua Connect" },
        { productId: "p2", brandId: "b-own" },
      ]),
    );
    assert.match(text, /HIBÁS tétel: 1/);
    assert.match(text, /ÚJ MÁRKA\tAqua Connect/);
    assert.match(text, /ÚJ MÁRKÁVAL\tp1\tRadion XR30\tAqua Connect/);
    assert.match(text, /HIBA\tp2\tRadion XR15\taz Acropora/);
  });
});

describe("a futás", () => {
  function setup(
    options: {
      products?: ListProduct[];
      assign?: (productId: string) => boolean;
      actor?: boolean;
      createFails?: boolean;
    } = {},
  ) {
    const written: string[] = [];
    const created: string[] = [];
    let out = "";
    let err = "";
    const deps: BrandFromListDependencies = {
      products: async () => options.products ?? PRODUCTS,
      brands: async () => BRANDS,
      actorExists: async () => options.actor ?? true,
      createBrand: async (name) => {
        if (options.createFails) throw new Error("adatbázis hiba");
        created.push(name);
        return { id: `new-${created.length}`, name };
      },
      assign: async (productId, brandId) => {
        const ok = options.assign ? options.assign(productId) : true;
        if (ok) written.push(`${productId}=${brandId}`);
        return ok;
      },
    };
    const run = (apply: boolean, items: unknown[]) =>
      runBrandFromListAction(
        apply,
        "u-actor",
        parseBrandListInput({ items }),
        {
          stdout: (v) => (out += v),
          stderr: (v) => (err += v),
        },
        deps,
      );
    return { run, written, created, out: () => out, err: () => err };
  }
  const ITEMS = [
    { productId: "p1", brandId: "b-eco" },
    { productId: "p2", newBrandName: "Aqua Connect" },
    { productId: "p4", newBrandName: "Aqua Connect" },
  ];

  it("a próba semmit nem ír és nem hoz létre", async () => {
    const s = setup();
    assert.equal(await s.run(false, ITEMS), 0);
    assert.deepEqual(s.written, []);
    assert.deepEqual(s.created, []);
    assert.match(s.out(), /Ez a futás semmit nem írt/);
  });

  it("a végrehajtás előbb létrehozza az új márkát (egyszer), aztán beírja a termékeket", async () => {
    const s = setup();
    assert.equal(await s.run(true, ITEMS), 0);
    assert.deepEqual(s.created, ["Aqua Connect"]);
    assert.deepEqual(s.written, ["p1=b-eco", "p2=new-1", "p4=new-1"]);
    assert.match(s.out(), /Létrehozott márka: 1\nMárkát kapott termék: 3/);
    assert.match(s.out(), /Felelős: u-actor/);
  });

  it("egy hibás tétel az EGÉSZ futást megállítja, a próbát is: semmi nem íródik", async () => {
    const s = setup();
    const items = [...ITEMS, { productId: "p5", brandId: "b-own" }];
    assert.equal(await s.run(false, items), 1);
    assert.equal(await s.run(true, items), 1);
    assert.deepEqual(s.written, []);
    assert.deepEqual(s.created, []);
    assert.match(
      s.err(),
      /1 hibás tételt tartalmaz, ezért a futás EL SEM INDULT/,
    );
  });

  it("név nélküli felhasználóval az írás el sem indul", async () => {
    const s = setup({ actor: false });
    assert.equal(await s.run(true, ITEMS), 1);
    assert.deepEqual(s.written, []);
    assert.deepEqual(s.created, []);
    assert.match(s.err(), /Nincs ilyen felhasználó: u-actor/);
  });

  it("ami közben márkát kapott, kimarad és megnevezve", async () => {
    const s = setup({ assign: (id) => id !== "p2" });
    assert.equal(await s.run(true, ITEMS), 0);
    assert.deepEqual(s.written, ["p1=b-eco", "p4=new-1"]);
    assert.match(
      s.out(),
      /KIHAGYVA \(közben márkát kapott\)\tp2\tAqua Connect/,
    );
    assert.match(s.out(), /Kihagyva, mert közben márkát kapott: 1/);
  });

  it("a márka-létrehozás hibája félbehagyottnak jelzi, és a hibát továbbadja", async () => {
    const s = setup({ createFails: true });
    await assert.rejects(s.run(true, ITEMS), /adatbázis hiba/);
    assert.deepEqual(s.written, []);
    assert.match(s.err(), /FÉLBEHAGYVA/);
  });

  it("a már márkás termék nem íródik felül", async () => {
    const s = setup();
    assert.equal(await s.run(true, [{ productId: "p3", brandId: "b-eco" }]), 0);
    assert.deepEqual(s.written, []);
    assert.match(s.out(), /KIHAGYVA \(van márkája\)\tp3/);
  });
});
