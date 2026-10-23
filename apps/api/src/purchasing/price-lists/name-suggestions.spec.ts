import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildNameIndex,
  MAX_SUGGESTIONS,
  sizesOf,
  suggestByName,
  wordsOf,
  type NameCandidate,
} from "./name-suggestions.js";

/**
 * A NÉV-ALAPÚ JAVASLAT (task arlista-nev-javaslat). Kitalált termékek. MI
 * PIROSÍT: ha a márka, a kiszerelés vagy az egybetűs modell-jel nem számítana
 * (A és C verzió összekeveredne, 2 kg és 500 g egy termék lenne); ha a kisbetű,
 * ékezet vagy az egybeírás eltérése elvenné a találatot; ha a rövid név, a
 * gyenge átfedés vagy a más márka is javaslatot adna; ha háromnál több jönne.
 */
const candidates: NameCandidate[] = [
  { variantId: "a", name: "Exbrand Component A 2000ml", brand: "Exbrand" },
  { variantId: "c", name: "Exbrand Component C 2000ml", brand: "Exbrand" },
  {
    variantId: "salt2",
    name: "Exbrand Reef Salt tengeri só 2kg",
    brand: "Exbrand",
  },
  {
    variantId: "salt5",
    name: "Exbrand Reef Salt tengeri só 500g",
    brand: "Exbrand",
  },
  {
    variantId: "other",
    name: "Otherbrand Reef Salt tengeri só 2kg",
    brand: "Otherbrand",
  },
  { variantId: "rowa", name: "Rowa Carbon aktív szén", brand: null },
  {
    variantId: "zoo",
    name: "Marinex Zooton zooplankton 100ml",
    brand: "Marinex",
  },
];
const index = buildNameIndex(candidates);
const ask = (name: string, brand: string | null = null) =>
  suggestByName(index, { supplierSku: "S1", name, brand });

describe("sizesOf and wordsOf", () => {
  it("reads 2 kg, 2kg and 2000 g as one size, and litres as millilitres", () => {
    assert.deepEqual(sizesOf("Salt 2 kg"), ["2000g"]);
    assert.deepEqual(sizesOf("Salt 2kg"), ["2000g"]);
    assert.deepEqual(sizesOf("Salt 2000 g"), ["2000g"]);
    assert.deepEqual(sizesOf("Liquid 1 l"), ["1000ml"]);
    assert.deepEqual(sizesOf("Liquid 1,5 liter"), ["1500ml"]);
    assert.deepEqual(sizesOf("Liquid 250 ml 120 g"), ["120g", "250ml"]);
  });

  it("keeps short model tokens and drops sizes and stop words", () => {
    assert.deepEqual(wordsOf("Component A 2000 ml und Set"), [
      "component",
      "a",
    ]);
    assert.deepEqual(wordsOf("Dr. Bassleer BF Garlic M 150 g"), [
      "dr",
      "bassleer",
      "bf",
      "garlic",
      "m",
    ]);
  });
});

describe("suggestByName", () => {
  it("suggests the product with the same brand, model and size, and says what it rests on", () => {
    const [first] = ask("Exbrand Component A 2000 ml", "Exbrand");
    assert.equal(first!.variantId, "a");
    assert.deepEqual(first!.basis.sizes, ["2000ml"]);
    assert.equal(first!.basis.brand, "exbrand");
    assert.ok(first!.basis.commonWords.includes("component"));
  });

  it("tells version A from version C by the one-letter token", () => {
    const a = ask("Exbrand Component A 2000 ml", "Exbrand").map(
      (s) => s.variantId,
    );
    const c = ask("Exbrand Component C 2000 ml", "Exbrand").map(
      (s) => s.variantId,
    );
    assert.equal(a[0], "a");
    assert.equal(c[0], "c");
    assert.ok(!a.includes("c"), "A must not suggest C");
  });

  it("does not take another pack size for the same product: 2 kg is not 500 g", () => {
    const ids = ask("Exbrand Reef Salt 2 kg", "Exbrand").map(
      (s) => s.variantId,
    );
    assert.ok(ids.includes("salt2"));
    assert.ok(!ids.includes("salt5"));
  });

  it("does not suggest a product of another brand even when most of the words overlap", () => {
    const ids = ask("Exbrand Reef Salt tengeri só 2 kg", "Exbrand").map(
      (s) => s.variantId,
    );
    assert.ok(ids.includes("salt2"));
    assert.ok(!ids.includes("other"));
  });

  it("is not thrown by case, accents or a joined word (ROWAcarbon ~ Rowa Carbon)", () => {
    assert.equal(ask("ROWAcarbon aktív szén")[0]?.variantId, "rowa");
    assert.equal(
      ask("EXBRAND Cömponent A 2000 ML", "exbrand")[0]?.variantId,
      "a",
    );
  });

  it("allows a weight where we name a volume, but ranks it lower than a matching size", () => {
    const [zoo] = ask("Marinex Zooton zooplankton 60 g", "Marinex");
    assert.equal(zoo?.variantId, "zoo");
    const withSize = ask("Marinex Zooton zooplankton 100 ml", "Marinex")[0]!;
    assert.ok(withSize.score > zoo!.score);
  });

  it("suggests nothing for a name too short or a weak overlap", () => {
    assert.deepEqual(ask("Salt"), []);
    assert.deepEqual(ask("Exbrand Cleaning Brush Large", "Exbrand"), []);
    assert.deepEqual(ask(""), []);
  });

  it("gives at most three, best first", () => {
    const many = buildNameIndex(
      Array.from({ length: 6 }, (_, i) => ({
        variantId: `v${i}`,
        name: `Exbrand Reef Salt tengeri só variant${i}`,
        brand: "Exbrand",
      })),
    );
    const found = suggestByName(many, {
      supplierSku: "S1",
      name: "Exbrand Reef Salt tengeri só",
      brand: "Exbrand",
    });
    assert.equal(found.length, MAX_SUGGESTIONS);
    for (let i = 1; i < found.length; i++)
      assert.ok(found[i - 1]!.score >= found[i]!.score);
  });
});
