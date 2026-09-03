import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertStorageKeyMatches,
  storageKeyFor,
} from "./document-storage-key.js";

/**
 * A TAROLT KULCS ES A LEMEZEN ALLO UT UGYANAZ AZ ALAK.
 *
 * 2026-09-03 elott a tarolt kulcs `<assetId>/<documentId>` volt, a fajl viszont
 * az `assets/` alatt allt: ket alak ugyanarra a dologra. A gazda bevezetese ezt
 * egyesitette -- es epp ezert kell allitas ra, kulonben a ket alak legkozelebb
 * eszrevetlenul valik szet.
 */
describe("a dokumentum tarolo-kulcsa", () => {
  it("az ESZKOZ kulcsa az `assets` konyvtarral kezdodik", () => {
    /*
      EZ A MAI ELRENDEZES, es a lemezen allo fajlok (ha egyszer lesznek) ezen az
      uton talalhatok. Aki atirja, a meglevo fajlokat teszi lathatatlanna.

      MI PIROSIT: a gazda konyvtarnevenek megvaltoztatasa.
    */
    assert.equal(
      storageKeyFor({ owner: "asset", ownerId: "esz-1", documentId: "d-1" }),
      "assets/esz-1/d-1",
    );
  });

  it("a MUNKALAP kulcsa MAS gyokerbe megy", () => {
    // ISMERT POZITIV KONTROLL a fentihez: e nelkul egy valtozat, ami MINDEN
    // gazdara `assets`-et ir, atmenne az elso allitason.
    assert.equal(
      storageKeyFor({ owner: "worksheet", ownerId: "ml-1", documentId: "d-1" }),
      "worksheets/ml-1/d-1",
    );
  });

  it("a KET GAZDA nem irhat egymas fole", () => {
    /*
      Ugyanaz az azonosito ket kulonbozo gazdanal ket kulonbozo fajl. Egy kozos
      gyoker mellett egy munkalap-kep FELULIRHATNA egy eszkoz-dokumentumot --
      es az adatvesztes lenne, nem utkozes-hiba.
    */
    assert.notEqual(
      storageKeyFor({ owner: "asset", ownerId: "x", documentId: "d" }),
      storageKeyFor({ owner: "worksheet", ownerId: "x", documentId: "d" }),
    );
  });

  it("a MAI elrendezestol eltero tarolt kulcson MEGALL", () => {
    /*
      Ha a sor mas elrendezessel keszult, a helyes viselkedes a megallas, nem
      az, hogy a mai elrendezes szerint keresunk egy fajlt, ami nincs ott. Az
      utobbi „a dokumentum nem talalhato" hibat adna -- egy MASIK, artalmatlanabb
      helyzet leirasat.
    */
    assert.throws(
      () =>
        assertStorageKeyMatches("esz-1/d-1", {
          owner: "asset",
          ownerId: "esz-1",
          documentId: "d-1",
        }),
      /nem a mai elrendezés szerint áll/,
    );
  });

  it("az EGYEZO kulcson nem all meg", () => {
    // ISMERT POZITIV KONTROLL: e nelkul egy valtozat, ami MINDIG dob, atmenne a
    // fenti allitason, es egyetlen letoltes sem mukodne.
    assert.doesNotThrow(() =>
      assertStorageKeyMatches("assets/esz-1/d-1", {
        owner: "asset",
        ownerId: "esz-1",
        documentId: "d-1",
      }),
    );
  });
});
