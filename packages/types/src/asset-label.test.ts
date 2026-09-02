import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ASSET_LABEL_CODE_STORED_PATTERN,
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
