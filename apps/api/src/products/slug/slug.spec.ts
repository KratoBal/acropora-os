import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  baseProductSlug,
  resolveSlug,
  slugify,
  SLUG_ALAK,
  SLUG_MAX,
} from "./slug.js";

/**
 * A SLUG-ALGORITMUS (SEO P0 PR 5), a terv példáival. MI PIROSIT: egy példa más
 * slugot ad; a vágás szó közepén vagy kötőjellel végződik; az üres név nem a
 * cikkszámra esik vissza; az ütközés nem a SKU-utótagot, majd a számot adja; a
 * `SlugHistory` régi slugja szabadnak számít.
 */
describe("slugify, a terv példái", () => {
  for (const [nev, slug] of [
    [
      "Red Sea ReefMat 1200 – Csere tekercs",
      "red-sea-reefmat-1200-csere-tekercs",
    ],
    [
      "Korallen-Zucht Amino Acid High Concentrate 100 ml",
      "korallen-zucht-amino-acid-high-concentrate-100-ml",
    ],
    [
      "Hanna HI780-25 pH reagens koloriméterhez 100 mérés",
      "hanna-hi780-25-ph-reagens-kolorimeterhez-100-meres",
    ],
    ["Tropic Marin Pro-Reef só 25 kg", "tropic-marin-pro-reef-so-25-kg"],
    ["Ca+Mg 1,5 l", "ca-plusz-mg-1-5-l"],
    [
      "Hanna fotométerek, reagensek - Tesztek, mérés, vezérlés",
      "hanna-fotometerek-reagensek-tesztek-meres-vezerles",
    ],
    // a ° szóközzel körülvett üresre cserélődik: szóhatár marad (a terv betűje)
    ["Fűtő 230V/50Hz 25°C", "futo-230v-50hz-25-c"],
    ["Ősszel őrölt ŰRTARTALOM ß & æ", "osszel-orolt-urtartalom-ss-es-ae"],
  ] as const)
    it(nev, () => {
      assert.equal(slugify(nev), slug);
      assert.match(slugify(nev), SLUG_ALAK);
    });

  it("80 karakter, az utolsó teljes szónál, záró kötőjel nélkül", () => {
    const s = slugify(`${"a".repeat(30)} ${"b".repeat(30)} ${"c".repeat(30)}`);
    assert.equal(s, `${"a".repeat(30)}-${"b".repeat(30)}`);
    assert.ok(s.length <= SLUG_MAX);
    const egySzo = slugify("x".repeat(100));
    assert.equal(egySzo.length, SLUG_MAX);
  });

  it("üres név: termek-<sku-slug>; determinisztikus", () => {
    assert.equal(baseProductSlug("–––", "R 352/04"), "termek-r-352-04");
    assert.equal(slugify("Ca+Mg 1,5 l"), slugify("Ca+Mg 1,5 l"));
  });
});

describe("resolveSlug", () => {
  it("szabad alap marad; foglaltnál SKU-utótag, majd szám; a régi slug is foglalt", () => {
    assert.equal(resolveSlug("pumpa", "R1", new Set()), "pumpa");
    assert.equal(resolveSlug("pumpa", "R1", new Set(["pumpa"])), "pumpa-r1");
    assert.equal(
      resolveSlug("pumpa", "R1", new Set(["pumpa", "pumpa-r1", "pumpa-r1-2"])),
      "pumpa-r1-3",
    );
  });
});
