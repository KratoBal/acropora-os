import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  brandMonogram,
  categoryGroupIcon,
  thumbnailFallback,
} from "./entity-thumbnail-fallback.js";

// What must fail: a brand leaf ("Fauna Marin") getting no icon although its
// parent names the group; the root deciding before a nearer ancestor; a brand
// read from a category name; the brief's monogram examples drifting.
describe("the category group of a thumbnail", () => {
  it("a brand leaf takes its parent's group", () => {
    assert.equal(
      categoryGroupIcon(["Termékek", "Nyomelemek", "Fauna Marin"]),
      "droplet",
    );
    assert.equal(
      categoryGroupIcon(["Termékek", "Áramoltatók", "Maxspect"]),
      "waves",
    );
    assert.equal(
      categoryGroupIcon(["Termékek", "LED világítások", "Ecotech"]),
      "lightbulb",
    );
  });

  it("the nearest named ancestor decides, not the root", () => {
    // coral food under a chemistry branch is food
    assert.equal(
      categoryGroupIcon([
        "Termékek",
        "Nyomelemek",
        "Koralltápok",
        "Aquaforest",
      ]),
      "food",
    );
    // two levels up: Foszfátmegkötők is under Problémamegoldás
    assert.equal(
      categoryGroupIcon([
        "Termékek",
        "Problémamegoldás",
        "Foszfátmegkötők",
        "Rowa",
      ]),
      "droplet",
    );
  });

  it("the root alone, an unknown path or none: no icon", () => {
    assert.equal(categoryGroupIcon(["Termékek"]), null);
    assert.equal(categoryGroupIcon(["Termékek", "Ajándéktárgyak"]), null);
    assert.equal(categoryGroupIcon([]), null);
    assert.equal(categoryGroupIcon(null), null);
  });
});

describe("the brand monogram", () => {
  it("reads the brief's examples", () => {
    assert.equal(brandMonogram("Red Sea"), "RS");
    assert.equal(brandMonogram("Ecotech"), "EC");
    assert.equal(brandMonogram("Tropic Marin"), "TM");
    assert.equal(brandMonogram("Nyos"), "NY");
    assert.equal(brandMonogram("Reef Factory"), "RF");
    assert.equal(brandMonogram("ATI"), "ATI");
    assert.equal(brandMonogram("MaxSpect"), "MS");
  });

  it("no name, no monogram", () => {
    assert.equal(brandMonogram(null), null);
    assert.equal(brandMonogram("  "), null);
  });
});

describe("the fallback order", () => {
  it("category before brand, brand before generic", () => {
    assert.deepEqual(
      thumbnailFallback({
        categoryPath: ["Halak", "Gébek"],
        brandName: "Red Sea",
      }),
      { kind: "icon", icon: "fish" },
    );
    assert.deepEqual(
      thumbnailFallback({ categoryPath: ["Termékek"], brandName: "Red Sea" }),
      { kind: "monogram", text: "RS" },
    );
    assert.deepEqual(thumbnailFallback({ categoryPath: ["Termékek"] }), {
      kind: "generic",
    });
  });

  it("a brand-named category is not a brand", () => {
    // "Maxspect" as a category leaf under an unmapped parent, no brand set:
    // no monogram is made from the category
    assert.deepEqual(
      thumbnailFallback({
        categoryPath: ["Termékek", "Maxspect"],
        brandName: null,
      }),
      { kind: "generic" },
    );
  });
});
