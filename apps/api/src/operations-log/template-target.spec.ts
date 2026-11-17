import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  targetOfRow,
  targetShapeOf,
  templateAppliesTo,
} from "./template-target.js";

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

describe("targetOfRow", () => {
  const asset = (id: string, assetNumber: string, name: string) => ({
    asset: { id, assetNumber, name },
  });

  it("a kategória-sor CATEGORY, az eszközlista-sor ASSETS (szám szerint rendezve), egyik sem jelez", () => {
    assert.deepEqual(
      targetOfRow({
        assetCategory: { id: "c1", name: "Vízkezelés" },
        assets: [],
      }),
      {
        target: { kind: "CATEGORY", categoryId: "c1", name: "Vízkezelés" },
        both: false,
      },
    );
    const list = targetOfRow({
      assetCategory: null,
      assets: [asset("a2", "V2", "Kettő"), asset("a1", "V1", "Egy")],
    });
    assert.equal(list.both, false);
    assert.deepEqual(
      list.target.kind === "ASSETS"
        ? list.target.assets.map((a) => a.assetId)
        : [],
      ["a1", "a2"],
    );
  });

  it("CONTROL: a kategóriát ÉS eszközlistát is hordozó sor a kategóriát adja (mint eddig), és jelzi, hogy szabálysértő", () => {
    const both = targetOfRow({
      assetCategory: { id: "c1", name: "Vízkezelés" },
      assets: [asset("a1", "V1", "Egy")],
    });
    assert.equal(both.target.kind, "CATEGORY");
    assert.equal(both.both, true);
  });
});
