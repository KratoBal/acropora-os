import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  brandFromName,
  describeBrandFromNamePlan,
  planBrandFromName,
  type NameBrand,
} from "./brand-from-name.js";
import { runBrandFromNameCli } from "./brand-from-name.cli.js";

/**
 * THE BRAND FROM THE NAME (catalog action `brand-from-name`; acrobot 51093, 51098). WHAT TURNS IT RED: a brand that only
 * starts a word taken ("ATI" in "Atisonic"); "REDSEA" and "Red Sea" not both RedSea; an alias not counted; a brand that
 * fits by name and alias counted twice; two brands that fit giving one; a product with a brand touched; the plan writing;
 * the write without a named actor; a product that got a brand in the meantime overwritten. Invented names only.
 */
const BRANDS: NameBrand[] = [
  { id: "b-fm", name: "Fauna Marin" },
  { id: "b-rs", name: "RedSea" },
  { id: "b-ati", name: "ATI" },
  { id: "b-aq", name: "Aqua" },
  { id: "b-am", name: "Aqua Medic" },
  { id: "b-jb", name: "Jebao/Jecod", aliases: ["Jebao", "Jecod"] },
];
const brandOf = (name: string) => {
  const m = brandFromName(name, BRANDS);
  return m.kind === "ONE" ? m.brand.id : m.kind;
};

describe("márka a termék nevéből", () => {
  it("a név első 1-4 egész szava, szóközzel vagy anélkül; csak egy márka", () => {
    assert.equal(brandOf("Fauna Marin AMIN 1000ml"), "b-fm");
    assert.equal(brandOf("REDSEA - NO3:PO4-X 5000ml"), "b-rs");
    assert.equal(brandOf("Red Sea Coral Pro só"), "b-rs");
    assert.equal(brandOf("ATI Essentials Pro"), "b-ati");
    assert.equal(brandOf("Atisonic tisztító"), "NONE");
    assert.equal(brandOf("Aqua Medic Reefdoser"), "MANY");
    assert.equal(brandOf("Kitalált termék"), "NONE");
    assert.equal(brandOf(""), "NONE");
  });

  it("az alias úgy számít, mint a név, és egy márka egyszer", () => {
    assert.equal(brandOf("Jebao DCP-5000 szivattyú"), "b-jb");
    assert.equal(brandOf("JECOD SOW-4 áramoltató"), "b-jb");
    assert.equal(
      brandFromName("Jebao pumpa", [
        { id: "x", name: "Jebao", aliases: ["Jebao"] },
      ]).kind,
      "ONE",
    );
  });

  it("a terv: márkás terméket nem érint, két márkát nem választ, és tételesen kiírja", () => {
    const plan = planBrandFromName(
      [
        { productId: "p1", name: "Fauna Marin AMIN", brandId: null },
        { productId: "p2", name: "Fauna Marin Min S", brandId: "b-fm" },
        { productId: "p3", name: "Aqua Medic Reefdoser", brandId: null },
        { productId: "p4", name: "Amphiprion ocellaris", brandId: null },
      ],
      BRANDS,
    );
    assert.deepEqual(
      [
        plan.assign.map((a) => a.productId),
        plan.ambiguous.length,
        plan.noMatch,
        plan.hasBrand,
      ],
      [["p1"], 1, 1, 1],
    );
    const text = describeBrandFromNamePlan(plan);
    assert.match(text, /márkát kap: 1/);
    assert.match(text, /^MÁRKA\tp1\tFauna Marin\tFauna Marin AMIN$/m);
    assert.match(text, /^KÉT MÁRKA\tp3\tAqua \| Aqua Medic\t/m);
  });
});

describe("a parancs", () => {
  const deps = (taken = new Set<string>()) => {
    const writes: [string, string][] = [];
    return {
      writes,
      deps: {
        rows: async () => [
          { productId: "p1", name: "Fauna Marin AMIN", brandId: null },
          { productId: "p2", name: "RedSea Coral Pro", brandId: null },
        ],
        brands: async () => BRANDS,
        actorExists: async (id: string) => id === "u1",
        assign: async (productId: string, brandId: string) => {
          if (taken.has(productId)) return false;
          writes.push([productId, brandId]);
          return true;
        },
      },
    };
  };
  const output = () => {
    let text = "";
    return {
      out: {
        stdout: (v: string) => void (text += v),
        stderr: (v: string) => void (text += v),
      },
      text: () => text,
    };
  };

  it("a terv semmit nem ír", async () => {
    const d = deps();
    const o = output();
    assert.equal(await runBrandFromNameCli([], o.out, d.deps), 0);
    assert.deepEqual(d.writes, []);
    assert.match(o.text(), /semmit nem írt/);
  });

  it("az írás felelős nélkül vagy ismeretlen felelőssel el sem indul", async () => {
    for (const argv of [["--apply"], ["--apply", "--actor", "nincs"]]) {
      const d = deps();
      assert.equal(await runBrandFromNameCli(argv, output().out, d.deps), 1);
      assert.deepEqual(d.writes, []);
    }
  });

  it("az írás csak a még üres márkájú termékre megy; ami közben márkát kapott, kimarad és megnevezve áll", async () => {
    const d = deps(new Set(["p2"]));
    const o = output();
    assert.equal(
      await runBrandFromNameCli(["--apply", "--actor", "u1"], o.out, d.deps),
      0,
    );
    assert.deepEqual(d.writes, [["p1", "b-fm"]]);
    assert.match(o.text(), /^BEÍRVA\tp1\tFauna Marin$/m);
    assert.match(o.text(), /^KIHAGYVA \(közben márkát kapott\)\tp2\tRedSea$/m);
    assert.match(
      o.text(),
      /Márkát kapott termék: 1\nKihagyva, mert közben márkát kapott: 1\nFelelős: u1/,
    );
  });
});
