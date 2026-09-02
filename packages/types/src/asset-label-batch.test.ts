import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ASSET_LABEL_CODE_STORED_PATTERN } from "./asset-label.js";
import { randomAssetLabelCode } from "./asset-label-batch.js";

describe("matricakód generálása", () => {
  it("a kártyán álló alakot adja: egy betű és négy szám", () => {
    for (let i = 0; i < 200; i += 1) {
      assert.match(randomAssetLabelCode(), ASSET_LABEL_CODE_STORED_PATTERN);
    }
  });

  /**
   * A HATAROKON MULIK, NEM A KOZEPEN. Egy `Math.random`-ra epulo generator a
   * VELETLEN eseteiben szinte mindig helyeset ad; ami elromlik, az a ket
   * szelso ertek. Ezert a veletlent itt KIVALTJUK, es a ket szelet mérjuk.
   */
  it("a legkisebb és a legnagyobb véletlen értéken is jó alakot ad", () => {
    assert.equal(
      randomAssetLabelCode(() => 0),
      "A0000",
    );
    // A `Math.random` sosem ad pontosan 1-et, de a 0.999... eset a felso
    // hatar: itt derulne ki egy indexeles-hiba (Z helyett `undefined`) es a
    // negy szamjegy csonkulasa.
    assert.equal(
      randomAssetLabelCode(() => 0.9999999),
      "Z9999",
    );
  });

  it("a négy számjegy mindig kitöltött, vezető nullákkal", () => {
    // MI PIROSIT: ha valaki elhagyja a `padStart` hivast. A `7` es a `0007`
    // KET KULONBOZO kod a tablan, es a rovid alak a CHECK megkotesen hasalna
    // el -- a felhasznalonak, mentes kozben.
    assert.equal(
      randomAssetLabelCode(() => 0.0000001),
      "A0000",
    );
  });
});
