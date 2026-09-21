import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ALAP_IDOKORLAT_MS,
  FELTOLTES_IDOKORLAT_MS,
  keresIdokorlatja,
} from "./idokorlat";

/**
 * A HIVAS IDOKORLATJA -- VALODI ALLITASOKKAL, TELEFON NELKUL.
 *
 * A dontes azert all kulon, tiszta fuggvenyben, hogy merheto legyen: a
 * kliens maga halozatot hiv, ez a modul viszont csak szamot ad.
 */
describe("mennyi ideig várunk egy hívásra", () => {
  it("a rendes kérés a rövid határt kapja", () => {
    assert.equal(keresIdokorlatja({}), ALAP_IDOKORLAT_MS);
    assert.equal(
      keresIdokorlatja({ body: JSON.stringify({ title: "x" }) }),
      ALAP_IDOKORLAT_MS,
    );
  });

  /**
   * A FENYKEP-FELTOLTES UGYANEZEN AZ UTON MEGY. Egy huszmasodperces hatar epp
   * ott vagna el a munkat, ahol a leginkabb szamit: gyenge tereon, egy tobb
   * megabajtos kepnel.
   *
   * MI PIROSIT: ha a felismeres kiesik, es a feltoltes a rovid hatart kapja.
   * A ket szam KULONBOZOSEGE is allitas: ha egyformara allnank oket, ez a
   * teszt es az elozo egyszerre lenne zold, es semmit nem bizonyitana.
   */
  it("a fájl-feltöltés a hosszú határt kapja", () => {
    assert.equal(
      keresIdokorlatja({ body: new FormData() }),
      FELTOLTES_IDOKORLAT_MS,
    );
    assert.ok(
      FELTOLTES_IDOKORLAT_MS > ALAP_IDOKORLAT_MS,
      "a két határ egyforma, tehát a megkülönböztetés nem mér semmit",
    );
  });

  /**
   * A FELISMERES ALAK SZERINT MEGY, NEM `instanceof`-FAL: a React Native sajat
   * `FormData`-t hoz, a teszt-kornyezet a Node-et, es egy `instanceof` a ketto
   * kozul mindig csak az EGYIKRE igaz. A masikra CSENDBEN hamis lenne, vagyis
   * a feltoltes a telefonon a rovid hatart kapna -- itt viszont zold maradna.
   */
  it("az alakra ismer rá, nem a konstruktorra", () => {
    const idegenFormData = { append: () => {} };
    assert.equal(
      keresIdokorlatja({ body: idegenFormData }),
      FELTOLTES_IDOKORLAT_MS,
    );
  });

  /** A HIVO KIMONDOTT HATARA MINDENT FELULIR. */
  it("a hívó saját határa nyer", () => {
    assert.equal(keresIdokorlatja({ timeoutMs: 5_000 }), 5_000);
    assert.equal(
      keresIdokorlatja({ body: new FormData(), timeoutMs: 5_000 }),
      5_000,
    );
  });

  /**
   * A NULLA ES A NEGATIV NEM HATAR, HANEM HIBA -- es ilyenkor az
   * alapertelmezes lep be. Egy `timeoutMs: 0` kulonben AZONNAL megszakitana
   * minden hivast, es a felulet vegig "nincs kapcsolat" allapotot mutatna egy
   * mukodo halozaton.
   */
  it("a nulla nem határ, hanem hiba", () => {
    assert.equal(keresIdokorlatja({ timeoutMs: 0 }), ALAP_IDOKORLAT_MS);
    assert.equal(keresIdokorlatja({ timeoutMs: -1 }), ALAP_IDOKORLAT_MS);
  });
});
