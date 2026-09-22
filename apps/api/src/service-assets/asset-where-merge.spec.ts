import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assetCategoryWhere } from "./asset-category-filter.js";
import { assetLabelWhere } from "./asset-label-filter.js";
import { mergeAssetWhere } from "./asset-where-merge.js";

/**
 * AZ ELSO HAROM ALLITAS AZ ALAKOT ORZI, A NEGYEDIK A HIBAT, AMIERT A FUGGVENY
 * LETEZIK. A sorrend szandekos: ha az osszefuzes MINDIG `AND`-et adna, a
 * meglevo lekerdezesek alakja megvaltozna -- az nem hiba, de nem is az, amit
 * bevallottunk.
 */
describe("asset where merge", () => {
  it("URES resz nelkul ures objektumot ad", () => {
    assert.deepEqual(mergeAssetWhere({}, {}), {});
  });

  it("EGY erdemi resznel BETURE azt adja vissza", () => {
    assert.deepEqual(mergeAssetWhere({}, { categoryId: "cat-1" }, {}), {
      categoryId: "cat-1",
    });
  });

  it("KET erdemi reszt `AND` ala tesz", () => {
    assert.deepEqual(
      mergeAssetWhere({ kind: "SENSOR" }, { categoryId: "cat-1" }),
      { AND: [{ kind: "SENSOR" }, { categoryId: "cat-1" }] },
    );
  });

  /**
   * EZ AZ AZ ALLITAS, AMIERT AZ EGESZ FAJL LETEZIK, ES A KET VALODI SZUROVEL
   * MEGY, NEM KITALALT OBJEKTUMOKKAL.
   *
   * Mindketto `{ AND: [...] }` alakot ad vissza ket aggal. Ket SZORASSAL a
   * masodik elnyelte volna az elsot: a kereso MATRICA NELKULI, MEGIS V2196
   * kodu eszkozt kerne, es a valasz a KATEGORIA-feltetelt teljesito, de
   * matricas sorokat adna vissza -- ertelmes, nem ures, es rossz.
   *
   * A kitalalt objektumokkal irt valtozat NEM ezt merne: ott en valasztanam
   * meg, hogy utkozik-e a ket kulcs. Igy viszont az utkozes a VALODI szurok
   * tulajdonsaga, es ha barmelyik valaha atall `AND`-rol mas alakra, ez a sor
   * tovabbra is igazat mond.
   */
  it("a ket VALODI szuro egyutt is megorzi MIND A NEGY feltetelt", () => {
    const matrica = assetLabelWhere("without", "V2196");
    const kategoria = assetCategoryWhere("without", "cat-1");

    const egyutt = mergeAssetWhere(matrica, kategoria);

    assert.deepEqual(egyutt, { AND: [matrica, kategoria] });
    // A KONTROLL: a ket szuro TENYLEG utkozne -- mindketto ugyanarra a kulcsra
    // ir. Enelkul a fenti allitas akkor is zold lenne, ha soha nem lett volna
    // mit megvedeni.
    assert.ok("AND" in matrica, "a matrica-szuro AND alakot ad ket aggal");
    assert.ok("AND" in kategoria, "a kategoria-szuro AND alakot ad ket aggal");
    assert.deepEqual(Object.assign({}, matrica, kategoria), kategoria);
  });
});
