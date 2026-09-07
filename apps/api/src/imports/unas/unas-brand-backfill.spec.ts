import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  brandValueFromParameters,
  describeBrandBackfillPlan,
  planBrandBackfill,
  type BrandBackfillRow,
  type ExistingBrand,
} from "./unas-brand-backfill.js";

const sor = (
  productId: string,
  brandValue: string,
  currentBrandId: string | null = null,
): BrandBackfillRow => ({ productId, brandValue, currentBrandId });

const marka = (
  id: string,
  normalizedName: string,
  normalizedAliases: string[] = [],
): ExistingBrand => ({ id, normalizedName, normalizedAliases });

describe("a márka visszatöltés terve", () => {
  it("meglévő márkához hozzárendel", () => {
    const plan = planBrandBackfill(
      [sor("p1", "Fauna Marin")],
      [marka("b1", "fauna marin")],
    );

    assert.deepEqual(plan.assign, [
      { productId: "p1", brandId: "b1", brandValue: "Fauna Marin" },
    ]);
    assert.deepEqual(plan.createBrands, []);
  });

  /**
   * AZ ALIAS UTJA KULON ALLITAS: a `Brand.normalizedName` es a
   * `BrandAlias.normalizedAlias` KET oszlop, es egy terv, ami csak az elsot
   * nezi, a mai adaton is mukodne -- csak epp a szinonimakat hagyna ki.
   */
  it("aliason keresztül is hozzárendel", () => {
    const plan = planBrandBackfill(
      [sor("p1", "AquaMedic")],
      [marka("b1", "aqua medic", ["aquamedic"])],
    );

    assert.equal(plan.assign.length, 1);
    assert.equal(plan.assign[0]!.brandId, "b1");
  });

  it("ismeretlen értékből márka-rekordot javasol, termékszámmal", () => {
    const plan = planBrandBackfill(
      [sor("p1", "Triton"), sor("p2", "Triton"), sor("p3", "ATI")],
      [],
    );

    assert.deepEqual(plan.createBrands, [
      { name: "Triton", products: 2, sourceValues: ["Triton"] },
      { name: "ATI", products: 1, sourceValues: ["ATI"] },
    ]);
    assert.deepEqual(plan.assign, []);
  });

  /**
   * A LEGFONTOSABB ALLITAS, ES NEGATIV: a ketertelmu roviditesbol NEM csinalunk
   * rekordot es NEM irunk be markat. A csendes rossz marka a legrosszabb
   * kimenetel -- inkabb ne alljon ott semmi.
   */
  it("a kétértelmű rövidítést visszautasítja, nem hozza létre és nem írja be", () => {
    const plan = planBrandBackfill([sor("p1", "AI"), sor("p2", "ai")], []);

    assert.deepEqual(plan.assign, []);
    assert.deepEqual(plan.createBrands, []);
    assert.equal(plan.refused.length, 2);
    assert.equal(
      plan.refused.every((r) => /kétértelmű/.test(r.reason)),
      true,
    );
  });

  /**
   * ES A MASIK IRANY, MERT EGY MINDENT VISSZAUTASITO TERV UGYANIGY NEZNE KI: egy
   * rendes markanev NEM esik a visszautasitottak koze.
   */
  it("a rendes márkanevet NEM utasítja vissza", () => {
    const plan = planBrandBackfill([sor("p1", "Aquaforest")], []);

    assert.deepEqual(plan.refused, []);
    assert.equal(plan.createBrands.length, 1);
  });

  /**
   * A CSOPORTOSITAS A NORMALIZALT ALAKRA MEGY -- ES EZT EGY MERES HOZTA ELO.
   *
   * A valos 683 termek 49 nyers erteket hordoz, de csak 48 kulonbozo
   * normalizalt alakot: az `OASE` (13) es az `Oase` (6) ugyanaz a marka. Nyers
   * ertek szerint csoportositva a terv KET rekordot keszitene ugyanazzal a
   * `normalizedName` ertekkel, es a masodik letrehozas MENET KOZBEN hasalna el
   * a tarolo azonossag-orzojen -- amikor az elso termekek mar megkaptak a
   * markat.
   */
  it("a csak írásmódban eltérő értékeket EGY márkába vonja össze", () => {
    const plan = planBrandBackfill(
      [sor("p1", "OASE"), sor("p2", "OASE"), sor("p3", "Oase")],
      [],
    );

    assert.equal(plan.createBrands.length, 1);
    assert.equal(plan.createBrands[0]!.products, 3);
    assert.deepEqual(plan.createBrands[0]!.sourceValues, ["OASE", "Oase"]);
  });

  it("a terv szövege kiírja, ha egy márka több írásmóddal áll a forrásban", () => {
    const szoveg = describeBrandBackfillPlan(
      planBrandBackfill([sor("p1", "OASE"), sor("p2", "Oase")], []),
    );

    assert.match(szoveg, /2 írásmóddal: OASE, Oase/);
  });

  /**
   * A FOSZAM AZT MONDJA MEG, AMIT A VEGREHAJTAS TENNI FOG.
   *
   * MERT HIBA: az elso valtozat foszama az `assign` hossza volt, es URES
   * `Brand` tabla mellett ez NULLA -- mert a markak meg nem leteznek. A
   * vegrehajtas viszont a letrehozas UTAN ujratervez, es akkor MINDEN sor
   * markat kap. A lap teteje nullat allitott arra a kerdesre, aminek a valasza
   * a teljes darabszam -- engedelykeresnek megteveszto.
   */
  it("a főszám a létrehozás UTÁNI állapotot mondja, nem a mait", () => {
    const szoveg = describeBrandBackfillPlan(
      planBrandBackfill([sor("p1", "Triton"), sor("p2", "Triton")], []),
    );

    assert.match(szoveg, /Márkát kapna: 2 termék/);
    assert.match(szoveg, /ebből meglévő márka-rekordhoz: 0/);
    assert.match(szoveg, /ebből a most létrehozandó rekordokhoz: 2/);
  });

  it("akin már van márka, ahhoz nem nyúl", () => {
    const plan = planBrandBackfill(
      [sor("p1", "Triton", "mar-all")],
      [marka("b1", "triton")],
    );

    assert.deepEqual(plan.assign, []);
    assert.equal(plan.alreadySet, 1);
  });

  /**
   * A KIMENET MONDJA MEG, MI MARAD KI -- ugyanaz a szabaly, amit a
   * termek-vetites kimenetere is bevezettunk: a siker ne olvasodjon tobbnek,
   * mint ami.
   */
  it("a terv szövege kimondja, mi marad ki és mire nem terjed ki", () => {
    const szoveg = describeBrandBackfillPlan(
      planBrandBackfill([sor("p1", "AI"), sor("p2", "Triton")], []),
    );

    assert.match(szoveg, /AMI EBBŐL KIMARAD/);
    /**
     * A VISSZAUTASITOTT TETELT NEV SZERINT keressuk, nem a "ketertelmu" szot.
     *
     * MERT HIBA: az elso valtozat a /ketertelmu/ mintara illesztett, es az a
     * szo a zaro MAGYARAZO mondatban IS ott all -- vagyis az allitas akkor is
     * zold maradt, ha EGYETLEN tetelt sem utasitottunk vissza. Egy celzott
     * rontas (a szotari tiltas kiiktatasa) NEM pirositotta ki, es epp ez
     * derult ki abbol, hogy a vart piros-szamot elore kiirtam.
     */
    assert.match(szoveg, /^ {2}AI -- 1 termék -- .*kétértelmű/m);
    assert.match(szoveg, /se kategóriát, se árat, se készletet/);
  });
});

describe("a brand paraméter kiolvasása a tárolt tömbből", () => {
  it("ékezet- és kisbetű-függetlenül találja meg", () => {
    assert.equal(
      brandValueFromParameters([
        { name: "Gyártói cikkszám", value: "X" },
        { name: "Brand", value: "Triton" },
      ]),
      "Triton",
    );
  });

  it("üres vagy hiányzó értékre null", () => {
    assert.equal(
      brandValueFromParameters([{ name: "brand", value: "  " }]),
      null,
    );
    assert.equal(
      brandValueFromParameters([{ name: "egyeb", value: "X" }]),
      null,
    );
    assert.equal(brandValueFromParameters(null), null);
    assert.equal(brandValueFromParameters("nem tömb"), null);
  });
});
