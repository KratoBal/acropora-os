import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { magyarSzamErteke } from "./magyar-szam.js";

/**
 * A HÁROM ESET, AMIT A KÁRTYA KÉR (cdb2796b), ÉS MIND A HÁROM KELL.
 *
 * A harmadik nélkül egy túl megengedő normalizálás ZÖLDEN átcsúszna: ami ma
 * elbukik, az ezután is bukjon el.
 */
describe("a magyar írásmóddal beírt szám", () => {
  it("a vesszős érték átmegy", () => {
    assert.equal(magyarSzamErteke("0,5"), 0.5);
    assert.equal(magyarSzamErteke("1,25"), 1.25);
    assert.equal(magyarSzamErteke(" 2,0 "), 2);
  });

  it("a pontos érték TOVÁBBRA IS átmegy", () => {
    assert.equal(magyarSzamErteke("0.5"), 0.5);
    assert.equal(magyarSzamErteke("3"), 3);
  });

  /**
   * AMI MA ELBUKIK, AZ EZUTÁN IS BUKJON EL. Egy javítás, ami mindent elfogad,
   * a rossz adatot csendben beengedi -- az rosszabb a mai hibaüzenetnél.
   */
  it("az értelmetlen érték TOVÁBBRA IS elbukik", () => {
    for (const rossz of ["0,5,5", "abc", "1,2,3", "--", "1 2"])
      assert.ok(
        Number.isNaN(magyarSzamErteke(rossz)),
        `a(z) "${rossz}" átcsúszott, holott nem szám`,
      );
  });

  /*
    ITT ÁLLT EGY ÁLLÍTÁS ARRÓL, HOGY MINDEN VESSZŐ CSERÉLŐDIK, ÉS KIVETTEM --
    MERT A KALIBRÁCIÓ MEGMUTATTA, HOGY NEM TUD ELBUKNI.

    A `replace` és a `replaceAll` KÜLÖNBSÉGE a függvény visszatérési értékén
    NEM LÁTSZIK. Egy vessző mellett a kettő azonos; kettő vagy több vessző
    mellett mind a kettő `NaN`-t ad (a maradék vessző ugyanúgy elrontja a
    számot, mint a második pont). Vagyis nincs olyan bemenet, amin a két alak
    MÁS eredményt adna.

    Az állításom ezt nem vette észre: két `NaN`-t hasonlított össze, és az
    `assert.equal` (Object.is) szerint `NaN` egyenlő `NaN`-nal -- tehát zöld
    maradt a rontás alatt is. Pontosan az a fajta halott állítás, amit ma már
    többször elkaptunk máshol.

    A `replaceAll` ettől még marad, de az indoka OLVASHATÓSÁG, nem viselkedés,
    és ezt a modul fejléce mondja ki. Egy nem mérhető szabályra nem írunk
    állítást, ami mérésnek látszik.
  */

  /**
   * NEM LESZ SZIGORÚBB SEM. A negatív érték ma átmegy a kliensen, és a
   * SZERVER utasítja el, név szerint -- ezt a kör nem írja át, mert az egy
   * MÁSIK döntés volna, és csendben változtatna a hibaüzeneten.
   */
  it("a negatív érték a szerverre marad, ahogy eddig", () => {
    assert.equal(magyarSzamErteke("-5"), -5);
    assert.equal(magyarSzamErteke("-0,5"), -0.5);
  });
});
