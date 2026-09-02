import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ASSET_LABEL_CODE_STORED_PATTERN,
  ASSET_LABEL_REQUIRED_ON_CREATE,
  assetLabelCreateProblem,
  normalizeAssetLabelCode,
} from "./asset-label.js";

describe("matricakód normalizálása", () => {
  it("elfogadja a kártyán álló alakot", () => {
    assert.equal(normalizeAssetLabelCode("V2196"), "V2196");
  });

  it("kisbetűs leolvasást felfelé normalizál", () => {
    // Egy leolvasó, ami kisbetűt ad vissza, ugyanazt a matricát látja.
    assert.equal(normalizeAssetLabelCode("v2196"), "V2196");
  });

  it("levágja a körülötte álló szóközt", () => {
    assert.equal(normalizeAssetLabelCode("  V2196 \n"), "V2196");
  });

  /**
   * A NEMLEGES ESETEK MELLÉ ODATARTOZIK, HOGY A MINTA MEG TUDJA TALÁLNI A JÓT
   * IS. Enélkül egy mindent elutasító függvény is zölden állna itt: minden
   * `null`-t váró állítás teljesülne, és a fenti három sor önmagában nem
   * zárja ki, hogy a `null` az ALAPÉRTELMEZETT válasz legyen.
   */
  it("elutasít mindent, ami nem egy betű és négy szám", () => {
    for (const rossz of [
      "",
      "V219", // három szám
      "V21966", // öt szám
      "VV2196", // két betű
      "2196", // betű nélkül
      "V2196X", // utána még valami
      "V-2196", // elválasztóval
      "Ő2196", // ékezetes betű: a minta ASCII betűre szól
      "V21 96", // belső szóköz
    ]) {
      assert.equal(
        normalizeAssetLabelCode(rossz),
        null,
        `${JSON.stringify(rossz)} nem lehet érvényes matricakód`,
      );
    }
  });

  it("amit visszaad, az megfelel a TÁBLA megkötésének", () => {
    // A tárolt alak mintája ugyanaz, ami a migrációban CHECK-ként áll. Ha a
    // kettő elcsúszna, a beszúrás az adatbázisban bukna el, nem itt -- és a
    // hibaüzenet a felhasználónak szólna, nem a fejlesztőnek.
    for (const nyers of ["v2196", "V2196", " a0000 "]) {
      const kod = normalizeAssetLabelCode(nyers);
      assert.ok(kod, `${nyers} érvényes bemenet`);
      assert.match(kod, ASSET_LABEL_CODE_STORED_PATTERN);
    }
  });
});

describe("a matricakód a felvitelkor", () => {
  it("a jó alakot átengedi", () => {
    assert.equal(assetLabelCreateProblem("V2196"), null);
    assert.equal(assetLabelCreateProblem(" v2196 "), null);
  });

  it("a rossz alakot megnevezi", () => {
    assert.equal(assetLabelCreateProblem("ROSSZ"), "malformed");
    assert.equal(assetLabelCreateProblem("V219"), "malformed");
  });

  /**
   * A HIANY KET DOLGOT JELENTHET, ES A KULONBSEG EGYETLEN KAPCSOLON MULIK.
   *
   * Ez az állítás SZÁNDÉKOSAN a kapcsolóhoz köti magát, nem a mai értékhez: ha
   * valaki megfordítja, ez a sor NEM pirosodik ki hamisan, viszont a
   * viselkedés-váltás azonnal látszik rajta. Egy `assert.equal(..., null)`
   * alak itt azt állítaná, hogy a mai érték az EGYETLEN helyes -- holott a
   * kérdés Balázsnál áll, és a válasz bármelyik lehet.
   */
  it("az üres mező a kapcsoló szerint dől el", () => {
    const vart = ASSET_LABEL_REQUIRED_ON_CREATE ? "missing" : null;
    assert.equal(assetLabelCreateProblem(undefined), vart);
    assert.equal(assetLabelCreateProblem(""), vart);
    assert.equal(assetLabelCreateProblem("   "), vart);
  });

  it("a rossz alak akkor is rossz, ha a matrica nem kötelező", () => {
    // A KET SZABALY FUGGETLEN: a "nem kotelezo" nem jelenti azt, hogy barmit
    // el lehet gepelni. Ha ez a ketto osszecsuszna, egy elgepelt kod CSENDBEN
    // ures matricakent menne at.
    assert.equal(assetLabelCreateProblem("XX99"), "malformed");
  });
});
