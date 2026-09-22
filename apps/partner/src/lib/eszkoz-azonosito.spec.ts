import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { eszkozAzonosito } from "./eszkoz-azonosito.js";

describe("eszkozAzonosito", () => {
  it("a MATRICA kódját adja, ha van", () => {
    assert.equal(
      eszkozAzonosito({ assetNumber: "ESZ-0042", labelCode: "V2196" }),
      "V2196",
    );
  });

  /**
   * A TARTALÉK. MÉRVE 2026-09-22, az éles adatbázisból: nyolcvanhárom eszközből
   * kilencen nincs matrica, tehát ez az ág ma kilenc sorra fut le.
   *
   * Attól még kell: egy azonosító nélküli sorról a partner nem tudná
   * megmondani, melyik eszközről beszél -- és ez a kilenctől független.
   */
  it("matrica NÉLKÜL a belső eszköz-szám marad", () => {
    assert.equal(eszkozAzonosito({ assetNumber: "ESZ-0042" }), "ESZ-0042");
  });

  /**
   * KONTROLL: A KÉT ÁG TÉNYLEG KÜLÖNBÖZIK.
   *
   * A fenti két állítás önmagában egy olyan megvalósításon is zöld lenne, ami
   * MINDIG a kapott objektum egyetlen mezőjét adja vissza -- ha a fixtúrában a
   * két érték véletlenül egyezne. Ezért a kontroll kimondja, hogy ugyanarra az
   * eszköz-számra a két eset MÁS eredményt ad.
   */
  it("KONTROLL: ugyanazon az eszköz-számon a két ág MÁST ad", () => {
    const matricaval = eszkozAzonosito({
      assetNumber: "ESZ-0042",
      labelCode: "V2196",
    });
    const matricaNelkul = eszkozAzonosito({ assetNumber: "ESZ-0042" });

    assert.notEqual(matricaval, matricaNelkul);
  });

  /**
   * AZ `undefined` AZ EGYETLEN HIÁNY-ALAK, ÉS EZT A SÉMA DÖNTI EL.
   *
   * A tárolt kód mintája `^[A-Z][0-9]{4}$` (adatbázis-szintű ellenőrző
   * megkötés), a bemeneté `^[A-Za-z][0-9]{4}$` -- üres szövegre egyik sem
   * illeszkedik. Ez az állítás azt rögzíti, hogy a függvény a HIÁNYRA esik
   * vissza, nem a hamis értékre: ha valaha `||` kerülne a `??` helyére, ez a
   * sor NEM pirosodna ki, tehát ez NEM az az őrző -- az indok a függvény
   * fejlécében áll, mérésként.
   *
   * Amit viszont megfog: ha valaki a hiányt üres szövegre cserélné a
   * szerződésben, a fenti tartalék-állítás azonnal elbukna.
   */
  it("a hiányzó mező és a hiányzó kulcs UGYANAZ", () => {
    assert.equal(
      eszkozAzonosito({ assetNumber: "ESZ-7", labelCode: undefined }),
      eszkozAzonosito({ assetNumber: "ESZ-7" }),
    );
  });
});
