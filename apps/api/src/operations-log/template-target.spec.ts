import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { targetShapeOf, templateAppliesTo } from "./template-target.js";

/*
  A SABLON CÉLJA ÉS AZ ESZKÖZ. MI PIROSIT: ha a listában szereplő eszköz kimaradna; ha egy kategória-célú sablon más kategóriájú eszközre
  is szólna; ha egy eszközlista-célú sablon az eszköz KATEGÓRIÁJA alapján is szólna (a lista nem kategória); ha egy üres cél bármire
  illeszkedne (a kategória nélküli eszközre sem, `null === null` alapon).
*/
const asset = (id: string, categoryId: string | null) => ({ id, categoryId });

describe("templateAppliesTo", () => {
  it("az eszközlistában szereplő eszközre szól, a többire nem, a kategóriától függetlenül", () => {
    const target = { assetIds: ["a1", "a2"], categoryId: null };
    assert.equal(templateAppliesTo(target, asset("a1", "c1")), true);
    assert.equal(templateAppliesTo(target, asset("a2", null)), true);
    assert.equal(templateAppliesTo(target, asset("a3", "c1")), false);
  });

  it("a kategória-célú sablon az ilyen kategóriájú eszközre szól, másra nem", () => {
    const target = { assetIds: [], categoryId: "c1" };
    assert.equal(templateAppliesTo(target, asset("a9", "c1")), true);
    assert.equal(templateAppliesTo(target, asset("a9", "c2")), false);
  });

  it("CONTROL: a cél nélküli sor semmire nem szól, a kategória nélküli eszközre sem (null nem egyenlő null)", () => {
    const empty = { assetIds: [], categoryId: null };
    assert.equal(templateAppliesTo(empty, asset("a1", null)), false);
    assert.equal(templateAppliesTo(empty, asset("a1", "c1")), false);
  });
});

describe("targetShapeOf", () => {
  it("az ASSETS a listát adja kategória nélkül, a CATEGORY a kategóriát lista nélkül", () => {
    assert.deepEqual(
      targetShapeOf({
        kind: "ASSETS",
        assets: [
          { assetId: "a1", assetNumber: "E1", name: "Egy" },
          { assetId: "a2", assetNumber: "E2", name: "Kettő" },
        ],
      }),
      { assetIds: ["a1", "a2"], categoryId: null },
    );
    assert.deepEqual(
      targetShapeOf({ kind: "CATEGORY", categoryId: "c1", name: "K" }),
      { assetIds: [], categoryId: "c1" },
    );
  });
});
