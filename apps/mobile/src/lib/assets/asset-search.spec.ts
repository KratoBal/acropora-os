import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  filterAssets,
  matchesAssetSearch,
  type SearchableAsset,
} from "./asset-search";

/**
 * A SZERELŐ EGY MATRICÁT OLVAS LE, ÉS NEM TUDJA, MELYIK MEZŐ AZ.
 *
 * A gépen lehet a mi eszközszámunk, a gyártó sorozatszáma vagy a partner saját
 * leltári száma. Ha a keresés csak az egyiket nézné, ugyanaz a beírt szöveg
 * hol találna, hol nem, és a szerelő azt hinné, az eszköz nincs felvéve.
 *
 * A mezők listája ugyanaz, mint a szerveré. Ha a kettő elcsúszna, ugyanaz a
 * keresés más eredményt adna térerővel és anélkül.
 */

const asset: SearchableAsset = {
  assetNumber: "ESZK-000123",
  name: "Fóka felnyomó szivattyú",
  manufacturer: "Eheim",
  model: "P-2",
  serialNumber: "SN-4711",
  inventoryNumber: "LT-8899",
  owner: { displayName: "Fánk Kft." },
};

describe("matchesAssetSearch", () => {
  it("finds the asset by any of the numbers on it", () => {
    for (const needle of ["ESZK-000123", "SN-4711", "LT-8899"])
      assert.equal(matchesAssetSearch(asset, needle), true, needle);
  });

  it("finds it by name, manufacturer, model and owner too", () => {
    for (const needle of ["szivattyú", "eheim", "p-2", "Fánk"])
      assert.equal(matchesAssetSearch(asset, needle), true, needle);
  });

  it("does not care about case", () => {
    assert.equal(matchesAssetSearch(asset, "eszk-000123"), true);
    assert.equal(matchesAssetSearch(asset, "SZIVATTYÚ"), true);
  });

  it("matches a fragment, because that is what someone types", () => {
    assert.equal(matchesAssetSearch(asset, "4711"), true);
  });

  it("says no when nothing on the machine matches", () => {
    assert.equal(matchesAssetSearch(asset, "kompresszor"), false);
  });

  /**
   * AZ ÜRES KERESÉS NEM SZŰR. Ha üresre törli a mezőt, a teljes listát kell
   * visszakapnia -- egy üres találati lista ott azt állítaná, hogy nincs eszköz.
   */
  it("keeps everything when the box is empty", () => {
    assert.equal(matchesAssetSearch(asset, ""), true);
    assert.equal(matchesAssetSearch(asset, "   "), true);
  });

  it("survives an asset with only the two required fields", () => {
    const bare: SearchableAsset = { assetNumber: "ESZK-1", name: "Szűrő" };
    assert.equal(matchesAssetSearch(bare, "ESZK-1"), true);
    assert.equal(matchesAssetSearch(bare, "SN"), false);
  });
});

describe("filterAssets", () => {
  const other: SearchableAsset = {
    assetNumber: "ESZK-000999",
    name: "Kompresszor",
    owner: { displayName: "Másik Kft." },
  };

  it("keeps the order the list came in", () => {
    const result = filterAssets([asset, other], "esz");
    assert.deepEqual(
      result.map((item) => item.assetNumber),
      ["ESZK-000123", "ESZK-000999"],
    );
  });

  it("returns a copy, not the same array", () => {
    const input = [asset, other];
    const result = filterAssets(input, "");
    assert.notEqual(result, input);
    assert.equal(result.length, 2);
  });
});
