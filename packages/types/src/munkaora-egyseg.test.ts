import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { munkaoraEgysegFigyelmeztetes } from "./munkaora-egyseg.js";

const szol = (kind: string, unit: string) =>
  munkaoraEgysegFigyelmeztetes({ kind, unit }) !== null;

/**
 * MIND A KÉT IRÁNY MÉRVE (957be72d, 4. kikötés).
 *
 * A második irány nélkül egy túl tág figyelmeztetés MINDEN soron elsülne, és
 * akkor senki nem olvassa el -- ugyanaz az ár, mint egy őrzőnél, ami mindig
 * beszél.
 */
describe("a munkaóra-sor mértékegysége", () => {
  it("db mellett SZÓL", () => {
    assert.equal(szol("LABOR", "db"), true);
    assert.equal(szol("LABOR", "m"), true);
    assert.equal(szol("LABOR", "kg"), true);
  });

  it("óra mellett NEM szól", () => {
    assert.equal(szol("LABOR", "óra"), false);
    assert.equal(szol("LABOR", "h"), false);
  });

  /**
   * A MEZŐ SZABAD SZÖVEG, tehát az írásmód változik. Az „Óra", az „ORA" és az
   * „ora" ugyanaz a szándék -- ha bármelyikre szólnánk, a figyelmeztetés
   * rendes sorokon sülne el, és három nap múlva senki nem olvassa.
   */
  it("az írásmód nem számít: Óra, ORA, ora", () => {
    for (const alak of ["Óra", "ORA", "ora", " óra ", "Munkaóra"])
      assert.equal(szol("LABOR", alak), false, `szólt erre: ${alak}`);
  });

  /**
   * A NEM-MUNKA SOR SOHA NEM SZÓL, akármi az egysége: ott a `db` a rendes
   * eset, és épp azt kérjük a kollégától.
   */
  it("a nem-munka sorra soha nem szól", () => {
    assert.equal(szol("OTHER", "db"), false);
    assert.equal(szol("OTHER", "óra"), false);
  });

  /**
   * AZ ÜRES EGYSÉG NEM SZÓL. A sor üres, amikor a kolléga még csak most kezdi
   * kitölteni -- egy figyelmeztetés gépelés közben arra, amit épp javítani
   * készül, ugyanaz a hiba, ami miatt a számmá alakítás is csak a beküldéskor
   * történik.
   */
  it("az üres egységre nem szól", () => {
    assert.equal(szol("LABOR", ""), false);
    assert.equal(szol("LABOR", "   "), false);
  });

  /**
   * A SZÖVEG MEGNEVEZI A BEÍRT EGYSÉGET, ÉS MEGMONDJA A TEENDŐT. Egy
   * „ellentmondás a soron" mondat megállítaná a kollégát anélkül, hogy tudná,
   * mit tegyen -- a figyelmeztetés TERELÉS, nem zár.
   */
  it("a mondat megnevezi az egységet és a teendőt", () => {
    const uzenet = munkaoraEgysegFigyelmeztetes({ kind: "LABOR", unit: "db" });
    assert.ok(uzenet);
    assert.match(uzenet, /db/);
    assert.match(uzenet, /munkaóra jelölést/);
  });
});
