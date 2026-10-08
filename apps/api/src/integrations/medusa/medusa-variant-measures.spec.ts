import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  decideVariantMeasures,
  measurePatch,
  variantMeasuresFor,
  type MeasureFact,
  type NativeMeasureField,
} from "./medusa-variant-measures.js";

/**
 * A TÖMEG ÉS A MÉRETEK DÖNTÉSE (SEO P0 PR 8). MI PIROSIT: egy változat-szintű
 * tény rossz változatra megy; egy termék-szintű tény többváltozatos terméknél
 * kimegy (melyik változatra?); a más egységű vagy nem szám érték kimegy; a
 * változat-szintű tény nem erősebb a termék-szintűnél; az egyező érték újra
 * íródik; a natív cél törlése nem kapcsolja ki a vetítést.
 */
const nativ = new Map<string, NativeMeasureField>([
  ["weight", "VARIANT_WEIGHT"],
  ["lengthMm", "VARIANT_LENGTH"],
  ["widthMm", "VARIANT_WIDTH"],
  ["heightMm", "VARIANT_HEIGHT"],
]);
const teny = (
  field: string,
  variantId: string | null,
  value: string | null,
  unit: string | null,
): MeasureFact => ({ field, variantId, value, unit });
const egy = [{ id: "v1", sku: "S1" }];
const ketto = [
  { id: "v1", sku: "S1" },
  { id: "v2", sku: "S2" },
];

describe("decideVariantMeasures", () => {
  it("a változat-szintű tény a saját változatára, a natív mezőnevekkel", () => {
    const d = decideVariantMeasures(
      [
        teny("weight", "v2", "120.5", "g"),
        teny("lengthMm", "v2", "300", "mm"),
        teny("widthMm", "v1", "40", "mm"),
      ],
      nativ,
      ketto,
    );
    assert.deepEqual(d.measures, [
      { sku: "S2", patch: { weight: 120.5, length: 300 } },
      { sku: "S1", patch: { width: 40 } },
    ]);
    assert.deepEqual(d.skipped, []);
  });

  it("a termék-szintű tény csak egyváltozatos terméknél megy ki", () => {
    assert.deepEqual(
      decideVariantMeasures([teny("weight", null, "500", "g")], nativ, egy)
        .measures,
      [{ sku: "S1", patch: { weight: 500 } }],
    );
    const tobb = decideVariantMeasures(
      [teny("weight", null, "500", "g")],
      nativ,
      ketto,
    );
    assert.deepEqual(tobb.measures, []);
    assert.deepEqual(
      tobb.skipped.map((s) => s.reason),
      ["multi-variant-product-fact"],
    );
  });

  it("a változat-szintű tény erősebb a termék-szintűnél, sorrendtől függetlenül", () => {
    const tenyek = [
      teny("weight", null, "500", "g"),
      teny("weight", "v1", "480", "g"),
    ];
    for (const t of [tenyek, [...tenyek].reverse()])
      assert.deepEqual(decideVariantMeasures(t, nativ, egy).measures, [
        { sku: "S1", patch: { weight: 480 } },
      ]);
  });

  it("más egység, nem szám, negatív és cikkszám nélküli változat: kimarad, okkal", () => {
    const d = decideVariantMeasures(
      [
        teny("weight", "v1", "0.5", "kg"),
        teny("lengthMm", "v1", "abc", "mm"),
        teny("widthMm", "v1", "-3", "mm"),
        teny("heightMm", "v3", "10", "mm"),
      ],
      nativ,
      [...egy, { id: "v3", sku: null }],
    );
    assert.deepEqual(d.measures, []);
    assert.deepEqual(
      d.skipped.map((s) => [s.field, s.reason]),
      [
        ["weight", "unit"],
        ["lengthMm", "not-a-number"],
        ["widthMm", "not-a-number"],
        ["heightMm", "no-sku"],
      ],
    );
  });

  it("a natív cél nélküli kulcs nem mérték", () => {
    assert.deepEqual(
      decideVariantMeasures([teny("dosing", "v1", "5", "ml")], nativ, egy),
      { measures: [], skipped: [] },
    );
  });
});

describe("measurePatch", () => {
  it("csak az eltérő mezők; az egyező nem íródik újra; ürítés nincs", () => {
    assert.deepEqual(
      measurePatch(
        { weight: 120, length: 300 },
        { id: "v", sku: "S", weight: 120, length: 250, width: 9, height: null },
      ),
      { length: 300 },
    );
  });
});

describe("variantMeasuresFor", () => {
  it("a natív célt a definíció mai sorából veszi: cél nélkül nem kérdez tényt", async () => {
    let tenyKerdes = 0;
    const db = (definiciok: { key: string; medusaNativeField: string }[]) => ({
      attributeDefinition: { findMany: async () => definiciok },
      productKnowledgeFact: {
        findMany: async () => {
          tenyKerdes += 1;
          return [teny("weight", "v1", "120", "g")];
        },
      },
    });
    assert.deepEqual((await variantMeasuresFor(db([]), "p", egy)).measures, []);
    assert.equal(tenyKerdes, 0);
    assert.deepEqual(
      (
        await variantMeasuresFor(
          db([{ key: "weight", medusaNativeField: "VARIANT_WEIGHT" }]),
          "p",
          egy,
        )
      ).measures,
      [{ sku: "S1", patch: { weight: 120 } }],
    );
  });
});
