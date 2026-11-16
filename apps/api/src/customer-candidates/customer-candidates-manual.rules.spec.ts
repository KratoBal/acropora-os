import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ManualListError,
  SIDE_EFFECT_CODES,
  parseManualEntries,
  planManualReplace,
} from "./customer-candidates-manual.rules.js";

/**
 * A KÉZI TERMÉKLISTA FÁJLJA (V3.4 S2c). MI PIROSÍT: egy rossz sor csendben kimarad, vagy egy félig érvényes sor bemegy; a foszfát (vagy
 * bármely nem jóváhagyott paraméter) mozgás lehet; nem https hivatkozás átmegy; ismeretlen mező vagy mellékhatás-kód átmegy; a
 * mellékhatás nem kanonikus; a tábla-cseréhez a terv rosszul számol.
 */
const row = (over: Record<string, unknown> = {}) => ({
  sku: "5902026730921",
  parameter: "KH",
  direction: "EMEL",
  referenceUrl: "https://shop.example/aquaforest-kh-plus",
  basis: "SHOP_TEXT",
  sideEffects: [],
  sideEffectsStatus: "FILLED",
  note: "AquaForest KH Plus",
  ...over,
});

describe("parseManualEntries", () => {
  it("a valid row is taken as it is, with the side effects in the canonical sorted KOD:IRANY form and an empty note as null", () => {
    const { entries, rejected } = parseManualEntries([
      row({
        sideEffects: [
          "SZILIKAT:CSOKKENT",
          "FOSZFAT:CSOKKENT",
          "STRONCIUM:EMEL",
        ],
        note: "  ",
      }),
    ]);
    assert.deepEqual(rejected, []);
    assert.deepEqual(entries[0]!.sideEffects, [
      "FOSZFAT:CSOKKENT",
      "STRONCIUM:EMEL",
      "SZILIKAT:CSOKKENT",
    ]);
    assert.equal(entries[0]!.note, null);
    assert.equal(entries[0]!.sku, "5902026730921");
  });

  it("the side-effect codes are the JEV codes minus the four approved parameters, plus STRONCIUM", () => {
    for (const code of [
      "FOSZFAT",
      "NITRIT",
      "SZILIKAT",
      "PH",
      "AMMONIA",
      "STRONCIUM",
    ])
      assert.ok(SIDE_EFFECT_CODES.has(code), code);
    for (const code of [
      "KH",
      "KALCIUM",
      "MAGNEZIUM",
      "NITRAT",
      "PHOSPHATE",
      "foszfat",
      "",
    ])
      assert.ok(!SIDE_EFFECT_CODES.has(code), code);
  });

  it("a file that is not an array is the file's error; a bad row is the row's: its number, its SKU and its reason, and the rest still parse", () => {
    assert.throws(() => parseManualEntries({}), ManualListError);
    assert.throws(() => parseManualEntries("x"), ManualListError);
    const { entries, rejected } = parseManualEntries([
      row({ sku: "ok" }),
      row({ sku: "bad", parameter: "FOSZFAT" }),
      "not an object",
      row({ sku: "also-ok", parameter: "NITRAT", direction: "CSOKKENT" }),
    ]);
    assert.deepEqual(
      entries.map((entry) => entry.sku),
      ["ok", "also-ok"],
    );
    assert.deepEqual(
      rejected.map((item) => [item.row, item.sku]),
      [
        [2, "bad"],
        [3, null],
      ],
    );
    assert.match(rejected[0]!.reason, /parameter/);
  });

  it("the movement is one of the four approved parameters in a known direction; phosphate, pH and the rest are refused", () => {
    for (const parameter of ["FOSZFAT", "PH", "AMMONIA", "kh", "", null, 7])
      assert.equal(
        parseManualEntries([row({ parameter })]).entries.length,
        0,
        String(parameter),
      );
    for (const direction of ["UP", "emel", "", null])
      assert.equal(
        parseManualEntries([row({ direction })]).entries.length,
        0,
        String(direction),
      );
    for (const parameter of ["KH", "KALCIUM", "MAGNEZIUM", "NITRAT"])
      assert.equal(
        parseManualEntries([row({ parameter })]).entries.length,
        1,
        parameter,
      );
  });

  it("the reference is https only: http, a bare host, a script, a space and a long address are refused", () => {
    for (const referenceUrl of [
      "http://shop.example/x",
      "shop.example/x",
      "javascript:alert(1)",
      "https://a b",
      "",
      null,
      `https://shop.example/${"x".repeat(500)}`,
    ])
      assert.equal(
        parseManualEntries([row({ referenceUrl })]).entries.length,
        0,
        String(referenceUrl),
      );
  });

  it("basis and status are the two known words each; anything else is refused", () => {
    for (const basis of ["maker", "SHOP", "", null, "MANUAL"])
      assert.equal(
        parseManualEntries([row({ basis })]).entries.length,
        0,
        String(basis),
      );
    for (const sideEffectsStatus of ["filled", "DONE", "", null])
      assert.equal(
        parseManualEntries([row({ sideEffectsStatus })]).entries.length,
        0,
        String(sideEffectsStatus),
      );
    assert.equal(
      parseManualEntries([
        row({ basis: "MAKER", sideEffectsStatus: "PENDING" }),
      ]).entries.length,
      1,
    );
  });

  it("a side effect must be KOD:IRANY with a known code and direction; the approved parameters are not side effects; a contradiction is refused", () => {
    for (const sideEffects of [
      ["FOSZFAT"],
      ["FOSZFAT:"],
      ["FOSZFAT:UP"],
      ["FOSZFAT:CSOKKENT:EMEL"],
      ["PHOSPHATE:CSOKKENT"],
      ["KALCIUM:EMEL"],
      ["FOSZFAT:CSOKKENT", "FOSZFAT:EMEL"],
      [7],
      "FOSZFAT:CSOKKENT",
      null,
    ])
      assert.equal(
        parseManualEntries([row({ sideEffects })]).entries.length,
        0,
        JSON.stringify(sideEffects),
      );
    // the same effect twice is one effect
    assert.deepEqual(
      parseManualEntries([
        row({ sideEffects: ["FOSZFAT:CSOKKENT", "FOSZFAT:CSOKKENT"] }),
      ]).entries[0]!.sideEffects,
      ["FOSZFAT:CSOKKENT"],
    );
  });

  it("an unknown field refuses the row (a mistyped key must not vanish), and a missing or over-long SKU too", () => {
    for (const bad of [
      { sideEffectz: [] },
      { price: 1 },
      { sku: "" },
      { sku: "x".repeat(65) },
      { sku: 5 },
    ])
      assert.equal(
        parseManualEntries([row(bad)]).entries.length,
        0,
        JSON.stringify(bad),
      );
    assert.match(
      parseManualEntries([row({ sideEffectz: [] })]).rejected[0]!.reason,
      /ismeretlen mező: sideEffectz/,
    );
  });

  it("the same SKU on the same move twice is refused (the second row), the same SKU on another move is fine", () => {
    const { entries, rejected } = parseManualEntries([
      row({ sku: "a" }),
      row({ sku: "a", note: "másodszor" }),
      row({ sku: "a", parameter: "KALCIUM" }),
    ]);
    assert.equal(entries.length, 2);
    assert.deepEqual(
      rejected.map((item) => item.row),
      [2],
    );
  });

  it("an over-long or non-text note is refused; no note is null", () => {
    assert.equal(
      parseManualEntries([row({ note: "x".repeat(1001) })]).entries.length,
      0,
    );
    assert.equal(parseManualEntries([row({ note: 5 })]).entries.length, 0);
    assert.equal(
      parseManualEntries([row({ note: undefined })]).entries[0]!.note,
      null,
    );
  });
});

describe("planManualReplace: the file is the whole list", () => {
  const stored = (productId: string, over: Record<string, unknown> = {}) => ({
    productId,
    sku: `s${productId}`,
    parameter: "KH",
    direction: "EMEL",
    referenceUrl: "https://shop.example/x",
    basis: "SHOP_TEXT",
    sideEffects: [] as string[],
    sideEffectsStatus: "FILLED",
    note: null as string | null,
    ...over,
  });

  it("counts added, changed, removed and unchanged rows", () => {
    const plan = planManualReplace(
      [stored("a"), stored("b"), stored("c")],
      [
        { ...stored("a"), sku: "sa" },
        { ...stored("b", { basis: "MAKER" }), sku: "sb" },
        { ...stored("d"), sku: "sd" },
      ],
    );
    assert.deepEqual(plan, { add: 1, update: 1, remove: 1, unchanged: 1 });
  });

  it("every field counts as a change, the side-effect order included, and the same move on another product is another row", () => {
    const base = [
      stored("a", { sideEffects: ["FOSZFAT:CSOKKENT", "PH:EMEL"] }),
    ];
    const same = [{ ...base[0]! }];
    assert.equal(planManualReplace(base, same).unchanged, 1);
    for (const change of [
      { referenceUrl: "https://shop.example/y" },
      { basis: "MAKER" },
      { sideEffectsStatus: "PENDING" },
      { note: "új" },
      { sideEffects: ["PH:EMEL", "FOSZFAT:CSOKKENT"] },
      { sideEffects: [] },
      // the SKU the product was imported under is part of the row: a changed SKU is a change, not "unchanged"
      { sku: "uj-cikkszam" },
    ])
      assert.equal(
        planManualReplace(base, [{ ...same[0]!, ...change }]).update,
        1,
        JSON.stringify(change),
      );
    assert.deepEqual(
      planManualReplace(base, [
        { ...same[0]!, parameter: "KALCIUM", sku: "x" },
      ]),
      {
        add: 1,
        update: 0,
        remove: 1,
        unchanged: 0,
      },
    );
  });

  it("an empty file removes everything, and an empty table adds everything", () => {
    assert.deepEqual(planManualReplace([stored("a"), stored("b")], []), {
      add: 0,
      update: 0,
      remove: 2,
      unchanged: 0,
    });
    assert.deepEqual(planManualReplace([], [{ ...stored("a"), sku: "x" }]), {
      add: 1,
      update: 0,
      remove: 0,
      unchanged: 0,
    });
  });
});
