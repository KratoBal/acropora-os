import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { signedSheetTypeFor } from "./worksheet-signed-sheet.js";

/**
 * A VEGLEGES LAP CSAK ELFOGADASNAL KESZUL.
 *
 * === MIERT VAN EGYALTALAN TISZTA FUGGVENY ERRE ===
 *
 * A dontes a `sign()` tranzakciojaban all, amit egysegteszt nem lat -- csak az
 * integracios keszlet, ami Postgres nelkul KIMARAD. Egy szabaly, amit csak a CI
 * tud merni, egy elgepeles utan is zold marad helyben. A kiemeles utan a szabaly
 * itt merheto, a BEKOTES pedig az integracios keszletben.
 */
describe("keszuljon-e vegleges lap", () => {
  it("ELFOGADASNAL a vegleges lap tipusat adja", () => {
    assert.equal(signedSheetTypeFor("ACCEPTED"), "SIGNED_SHEET");
  });

  /**
   * ELUTASITASNAL NEM KESZUL, ES EZ NEM KIMARADAS.
   *
   * Az allapot ekkor `REJECTED`, tehat a piszkozat-felirat feltetele
   * (`status !== "SIGNED"`) IGAZ MARAD: egy "vegleges"-nek nevezett dokumentum
   * PISZKOZAT felirattal menne a vevo ele -- epp az a kerdes nyilna ujra, amit
   * ez a tetel lezar.
   *
   * MI PIROSIT: ha valaki elutasitasra is gyartana lapot.
   */
  it("ELUTASITASNAL nem keszul lap", () => {
    assert.equal(signedSheetTypeFor("REJECTED"), null);
  });

  /**
   * ES A KET AG KULON ALL, NEM EGY ALLITASBAN.
   *
   * Egy allitasba irva a kalibracio kimenete nem mondana meg, melyik ag romlott
   * el: a futtato a TESZT nevet irja ki, nem az allitasét. Igy a "mindig
   * gyartson" rontas az ELUTASITAS allitasat donti pirosra, nev szerint, es a
   * masik zold marad -- vagyis a par MEGKULONBOZTET.
   */
  it("a ket dontes NEM ugyanazt adja", () => {
    assert.notEqual(
      signedSheetTypeFor("ACCEPTED"),
      signedSheetTypeFor("REJECTED"),
    );
  });
});
