import assert from "node:assert/strict";
import { after, before, describe, it, mock } from "node:test";

import { generateCode } from "./code-generator.util.js";

/**
 * AMIERT EZ A FAJL LETEZIK.
 *
 * A `generateCode` TIZ hivasi helyet szolgal ki, KILENC bizonylat-csaladban:
 * vevo- es szallitoszam, beszerzesi bizonylat, leltar, keszlet-korrekcio, POS
 * eladas es mozgas, partner, eszkoz. Es 2026-08-26-ig EGYETLEN teszt sem
 * vedte. Barmi, ami megvaltoztatta volna a viselkedeset, semmit nem tort volna
 * el -- a hiba nem a kodban volt, hanem abban, hogy senki nem merte.
 *
 * Ez a fajl a MAI viselkedest rogziti, nem donti el, hogy jo-e. Egy nyitott
 * kerdes van rajta, es az lent, a sajat helyen ki van mondva.
 */

/** 2026-08-26 11:38:56 UTC. Budapesten ugyanez a pillanat 13:38:56 (CEST). */
const INSTANT = Date.UTC(2026, 7, 26, 11, 38, 56, 123);

describe("generateCode", () => {
  before(() => {
    mock.timers.enable({ apis: ["Date"], now: INSTANT });
  });
  after(() => {
    mock.timers.reset();
  });

  it("keeps the prefix it was given", () => {
    assert.ok(generateCode("ESZK").startsWith("ESZK-"));
    assert.ok(generateCode("VEVO").startsWith("VEVO-"));
  });

  it("has the shape the label and the search both depend on", () => {
    // Elotag, datum, idopont, es negy hexa karakter. A cimke ebbol az UTOLSO
    // KET blokkot mutatja, az eszkozkereso pedig reszletre illeszt -- tehat ez
    // az alak nem kozmetika, hanem ket mas hely mukodesenek a feltetele.
    assert.match(generateCode("ESZK"), /^ESZK-\d{8}-\d{6}-[0-9A-F]{4}$/);
  });

  it("separates two codes made in the same second", () => {
    // Az idopont-resz azonos, tehat a megkulonboztetes A VELETLEN VEGEN mulik.
    const first = generateCode("ESZK");
    const second = generateCode("ESZK");

    assert.equal(first.slice(0, 20), second.slice(0, 20));
    assert.notEqual(first, second);
  });

  /**
   * A NYITOTT KERDES, KIMONDVA.
   *
   * Az idopont-blokk UTC-ben all, mert a kod `toISOString()`-bol keszul. A
   * cimkere az UTOLSO KET blokk kerul, tehat a szerelo `113856`-ot lat egy
   * olyan eszkozon, amit budapesti fali ora szerint 13 ora 38 perckor vettek
   * fel. Ket ora elteres, pont a munkaido kozepen.
   *
   * A helyi idore allas AZONBAN NEM nyilvanvaloan jobb: a helyi ido evente
   * egyszer ISMETLODIK (oraatallitas), tehat ket, egy oraval elteroen keletkezo
   * bizonylat ugyanazt a blokkot kaphatna, es a mar kiadott sorok UTC-ben
   * maradnanak, jelolo nelkul. Ez a teszt ezert a MAI alapot rogziti, es nem
   * dontest fogalmaz meg: ha a dontes megszuletik, ez a sor valt pirosra, es
   * pontosan ott all majd, ahol a valtozas tortent.
   */
  it("stamps the moment in UTC, not in the local wall clock", () => {
    const code = generateCode("ESZK");

    assert.match(code, /^ESZK-20260826-113856-/);
    // Ugyanez a pillanat Budapesten 13:38:56. Ha valaha a helyi ido lesz az
    // alap, ez a sor mondja meg, hogy a valtozas SZANDEKOS volt.
    assert.doesNotMatch(code, /^ESZK-20260826-133856-/);
  });

  it("uses the same clock for every document family", () => {
    // Egyetlen generator szolgal ki kilenc bizonylat-csaladot: ha az idoalap
    // valtozik, MINDEGYIKE valtozik vele. A teszt ezt allitja, hogy a hatokor
    // ne egy kommentben lakjon.
    for (const prefix of ["ESZK", "VEVO", "BESZ", "LELTAR", "KORR", "POS"])
      assert.match(generateCode(prefix), /-20260826-113856-[0-9A-F]{4}$/);
  });
});
