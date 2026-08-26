import assert from "node:assert/strict";
import { after, before, describe, it, mock } from "node:test";

import { generateCode, randomCodeSuffix } from "./code-generator.util.js";

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
   * A DONTES, KIMONDVA: MARAD AZ UTC. (2026-08-26)
   *
   * A kerdes ugy merult fel, hogy az idopont-blokk UTC-ben all, mert a kod
   * `toISOString()`-bol keszul. A cimkere az UTOLSO KET blokk kerul, tehat a
   * szerelo `113856`-ot lat egy olyan eszkozon, amit budapesti fali ora szerint
   * 13 ora 38 perckor vettek fel.
   *
   * A dontes megis az UTC maradasa lett, HAROM MERT INDOKKAL:
   * 1. AZONOSITOROL van szo, nem orarol, es a helyi ido evente egyszer
   *    ISMETLODIK (oraatallitas) -- vagyis pont abban bukna meg, amiert letezik.
   * 2. A MAR KIADOTT sorok UTC-ben maradnanak, tehat ugyanaz a mezo ket
   *    kulonbozo dolgot jelentene, jeloles nelkul.
   * 3. A cimke szovege a teljes azonosito SZO SZERINTI vege, es erre epul a
   *    `contains` illesztesu kereses. Egy atszamolt ido NEMAN szuntetne meg a
   *    visszakereseset; erre kulon teszt all a mobil oldalon.
   *
   * Ha a szerelonek olvashato idopont kell a cimken, az KULON mezokent fer ra,
   * es akkor a ket dolog nem keveredik. Ez a sor tehat nem nyitott kerdest
   * jelol, hanem egy meghozott dontest orzi: ha valaki megis atallitja az
   * idoalapot, itt valt pirosra, es itt talalja meg az indokot is.
   */
  it("stamps the moment in UTC, not in the local wall clock", () => {
    const code = generateCode("ESZK");

    assert.match(code, /^ESZK-20260826-113856-/);
    // Ugyanez a pillanat Budapesten 13:38:56. Ha valaha a helyi ido lesz az
    // alap, ez a sor mondja meg, hogy a valtozas SZANDEKOS volt.
    assert.doesNotMatch(code, /^ESZK-20260826-133856-/);
  });

  /**
   * AZ UTKOZES, DETERMINISZTIKUSAN ELOALLITVA.
   *
   * Ket bizonylat akkor kap AZONOS szamot, ha ugyanabban a masodpercben keszul
   * ES ugyanazt a negyjegyu veget huzza. A veletlenre varni nem teszt, hanem egy
   * 65 536-bol egy esely, ezert a veg vezerelheto -- es igy az utkozes NEM
   * ritka esemeny, hanem egy sor.
   *
   * EZ AZ ALLITAS MA MEG NEM JAVIT SEMMIT. Azt rogziti, hogy az utkozes
   * LEHETSEGES es reprodukalhato: enelkul barmilyen kesobbi javitast csak
   * hinni lehetne, merni nem.
   */
  it("mints two identical codes when the second and the tail both repeat", () => {
    const fixedTail = () => "AB12";

    const first = generateCode("ESZK", fixedTail);
    const second = generateCode("ESZK", fixedTail);

    assert.equal(first, second);
    assert.equal(first, "ESZK-20260826-113856-AB12");
  });

  it("still differs when only the tail differs", () => {
    // A kontroll: az elozo allitas nem azert zold, mert a generator MINDIG
    // ugyanazt adja. Azonos masodperc, MAS veg -> mas kod.
    const first = generateCode("ESZK", () => "AB12");
    const second = generateCode("ESZK", () => "99F0");

    assert.notEqual(first, second);
  });

  it("uses the real random tail when nobody passes one", () => {
    // A varrat NEM valtoztatja meg a mai viselkedest: hivo nelkul ugyanaz a
    // negy hexa karakter jon, mint eddig.
    assert.match(generateCode("ESZK"), /-[0-9A-F]{4}$/);
    assert.match(randomCodeSuffix(), /^[0-9A-F]{4}$/);
  });

  it("uses the same clock for every document family", () => {
    // Egyetlen generator szolgal ki kilenc bizonylat-csaladot: ha az idoalap
    // valtozik, MINDEGYIKE valtozik vele. A teszt ezt allitja, hogy a hatokor
    // ne egy kommentben lakjon.
    for (const prefix of ["ESZK", "VEVO", "BESZ", "LELTAR", "KORR", "POS"])
      assert.match(generateCode(prefix), /-20260826-113856-[0-9A-F]{4}$/);
  });
});
