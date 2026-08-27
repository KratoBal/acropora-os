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

/**
 * A CIMKERE KERULO SZAM HELYI IDO SZERINT ALL, ES A VALTAS JELOLVE VAN.
 *
 * A belyeg eddig UTC volt, tehat nyaron ket oraval a magyar fali ora mogott
 * jart, es este 22:00 utan a DATUM is egy nappal korabbi napot mutatott. A
 * cimkerol egy EMBER olvassa le -- neki ez rossz ora es rossz nap.
 *
 * A mar kiadott szamok visszamenoleg NEM valtoznak, tehat a sorozatban van egy
 * pont, ahol a belyeg jelentese megvaltozik. Jeloles nelkul ugyanaz a mezo ket
 * dolgot jelentene, kivulrol megkulonboztethetetlenul -- es az ROSSZABB, mint
 * az egysegesen rossz ertek, mert azt legalabb at lehet szamolni.
 */
describe("a cimkere kerulo belyeg", () => {
  it("keeps the block structure the label and the search depend on", () => {
    const code = generateCode("ESZK", () => "AB12", "local-marked");

    // Negy blokk, ugyanaz az elvalaszto: a mobil szetvagas, a `contains`
    // kereses es a rendezes valtozatlanul mukodik.
    assert.match(code, /^ESZK-\d{8}-\d{6}h-[0-9A-F]{4}$/);
    assert.equal(code.split("-").length, 4);
  });

  /**
   * A LENYEGI ALLITAS: a ket alak UGYANARRA a pillanatra MAS idot mutat, es a
   * kulonbseg a zona eltolasa. Enelkul a teszt akkor is zold lenne, ha a
   * `local-marked` csak egy `h`-t ragasztana az UTC ertekhez.
   */
  it("shows the Budapest wall clock, not UTC", () => {
    const utc = generateCode("ESZK", () => "AB12");
    const local = generateCode("ESZK", () => "AB12", "local-marked");

    const stamp = (code: string) => code.slice(5, 5 + 15).replace("-", "");
    const asMinutes = (value: string) =>
      Number(value.slice(8, 10)) * 60 + Number(value.slice(10, 12));

    const difference =
      (asMinutes(stamp(local)) - asMinutes(stamp(utc)) + 1440) % 1440;

    // Europe/Budapest: telen 60, nyaron 120 perc. A teszt nem koti le, melyik
    // van eppen -- azt koti le, hogy NEM nulla, es hogy a ketto kozul az egyik.
    assert.ok(
      difference === 60 || difference === 120,
      `a ket belyeg kulonbsege ${difference} perc`,
    );
  });

  it("leaves every other family on UTC", () => {
    // Az alapertelmezes valtozatlan: aki nem ker mast, azt kapja, amit eddig.
    assert.match(
      generateCode("BESZ", () => "AB12"),
      /^BESZ-\d{8}-\d{6}-AB12$/,
    );
    assert.match(
      generateCode("POS", () => "AB12"),
      /^POS-\d{8}-\d{6}-AB12$/,
    );
  });
});
