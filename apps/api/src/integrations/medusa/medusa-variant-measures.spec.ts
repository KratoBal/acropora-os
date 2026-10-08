import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  decideVariantMeasures,
  loadWrittenMeasures,
  planVariantMeasureWrite,
  sameLedger,
  saveWrittenMeasures,
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

describe("planVariantMeasureWrite (árva-kezelés)", () => {
  const sor = (
    m: Partial<Record<"weight" | "length" | "width" | "height", number | null>>,
  ) => ({
    id: "v",
    sku: "S",
    weight: null,
    length: null,
    width: null,
    height: null,
    ...m,
  });

  it("kért érték: eltérésnél ír, és nyilvántartásba veszi; egyezésnél csak nyilvántartás", () => {
    assert.deepEqual(
      planVariantMeasureWrite({ weight: 120 }, sor({ weight: 100 }), undefined),
      {
        patch: { weight: 120 },
        orphans: [],
        cleared: [],
        record: { weight: 120 },
      },
    );
    assert.deepEqual(
      planVariantMeasureWrite({ weight: 120 }, sor({ weight: 120 }), undefined)
        .patch,
      {},
    );
  });

  it("tény nélkül: a pontosan saját érték ürül, a más érték árva, az üres semmi", () => {
    const t = planVariantMeasureWrite(
      {},
      sor({ weight: 250, length: 99, width: null }),
      { weight: 250, length: 100, width: 40 },
    );
    assert.deepEqual(t.patch, { weight: null });
    assert.deepEqual(t.cleared, ["weight"]);
    assert.deepEqual(t.orphans, ["length"]);
    assert.deepEqual(t.record, {});
  });
});

describe("a nyilvántartás sora", () => {
  it("sameLedger kulcs-sorrendtől független, és értékre érzékeny", () => {
    assert.equal(
      sameLedger(
        { A: { weight: 1 }, B: { length: 2 } },
        { B: { length: 2 }, A: { weight: 1 } },
      ),
      true,
    );
    assert.equal(sameLedger({ A: { weight: 1 } }, { A: { weight: 2 } }), false);
    assert.equal(sameLedger({}, {}), true);
  });

  it("betöltés a saját ProductMeasure sorból; hiányzó vagy más alakú sor: üres", async () => {
    const kerdes: unknown[] = [];
    const db = (metadata: unknown) => ({
      externalReference: {
        findUnique: async (args: unknown) => {
          kerdes.push(args);
          return metadata === undefined ? null : { metadata };
        },
        upsert: async () => ({}),
      },
    });
    assert.deepEqual(
      await loadWrittenMeasures(db({ written: { A: { weight: 3 } } }), "p1"),
      {
        A: { weight: 3 },
      },
    );
    assert.deepEqual(await loadWrittenMeasures(db(undefined), "p1"), {});
    assert.deepEqual(await loadWrittenMeasures(db({ mas: 1 }), "p1"), {});
    assert.deepEqual((kerdes[0] as { where: unknown }).where, {
      system_entityType_entityId: {
        system: "MEDUSA",
        entityType: "ProductMeasure",
        entityId: "p1",
      },
    });
  });

  it("mentés: upsert a saját sorra, a nyilvántartással a metaadatban", async () => {
    const irasok: unknown[] = [];
    await saveWrittenMeasures(
      {
        externalReference: {
          findUnique: async () => null,
          upsert: async (a: unknown) => irasok.push(a),
        },
      },
      "p1",
      "prod_m",
      { A: { weight: 3 } },
      new Date("2026-10-08T00:00:00Z"),
    );
    const a = irasok[0] as {
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    assert.equal(a.create.entityType, "ProductMeasure");
    assert.deepEqual(a.update.metadata, { written: { A: { weight: 3 } } });
  });
});
