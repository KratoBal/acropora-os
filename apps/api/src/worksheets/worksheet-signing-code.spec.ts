import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_SIGNING_CODE,
  describeSigningCodeFailure,
  isWellFormedSigningCode,
} from "./worksheet-signing-code.js";

/**
 * AZ ALAIROKOD ALAKJA ES A HAROM BUKASI MOD.
 *
 * A legordulo azt rogziti, KINEK mondta magat az alairo; a kod az, ami ezt
 * bizonyitja. A harom bukasi mod teendoje MAS, ezert kap harom kulon mondatot.
 */

describe("a kód alakja", () => {
  it("PONTOSAN négy számjegy", () => {
    assert.equal(isWellFormedSigningCode("0000"), true);
    assert.equal(isWellFormedSigningCode("9137"), true);
    assert.equal(isWellFormedSigningCode("123"), false);
    assert.equal(isWellFormedSigningCode("12345"), false);
  });

  it("a SZÁMJEGYEN KÍVÜL semmi", () => {
    /*
      MI PIROSIT: egy lazabb minta (peldaul `\\d+`). A kod hossza maga a
      megallapodas: egy harom- vagy otjegyu ertek nem "majdnem jo", hanem MAS
      kod -- es a felhasznalo azt hinne, hogy elfogadtuk.
    */
    assert.equal(isWellFormedSigningCode("12a4"), false);
    assert.equal(isWellFormedSigningCode(""), false);
    assert.equal(isWellFormedSigningCode("１２３４"), false);
  });

  it("a KÖRNYEZŐ SZÓKÖZ nem teszi rosszá", () => {
    /*
      A telefon billentyuzete konnyen ad szokozt, es a " 1234" a felhasznalo
      szemszogebol UGYANAZ a kod. Egy szigoru olvasas itt olyan hibat mutatna,
      amit a beiro nem lat.
    */
    assert.equal(isWellFormedSigningCode("  1234 "), true);
  });

  it("az ALAPÉRTELMEZETT kód maga is érvényes alakú", () => {
    /*
      TESTVER-KONTROLL, ES NEM DISZ: ha az alapertelmezett ertek nem menne at a
      sajat alak-ellenorzesunkon, MINDEN ujonnan felvitt felhasznalo
      hasznalhatatlan kodot kapna -- es ez csak az elso alairaskor derulne ki,
      az ugyfel elott.
    */
    assert.equal(isWellFormedSigningCode(DEFAULT_SIGNING_CODE), true);
  });
});

describe("a három bukási mód", () => {
  it("MINDHÁROM külön mondatot kap", () => {
    /*
      A KULONBSEG NEM STILUS, HANEM A TEENDO. Az alak-hiba a beirasrol szol, a
      hianyzo tarolt kod a FIOKROL, az elteres pedig arrol, hogy az ott allo
      ember nem tudja a kodot. Egy kozos "hibas kod" mondat mind a haromra
      raillene, es a szerelo egyiket sem tudna megoldani.

      MI PIROSIT: barmelyik ketto osszevonasa.
    */
    const alak = describeSigningCodeFailure("malformed");
    const nincs = describeSigningCodeFailure("missing-code");
    const eltero = describeSigningCodeFailure("mismatch");
    assert.notEqual(alak, nincs);
    assert.notEqual(alak, eltero);
    assert.notEqual(nincs, eltero);
  });

  it("a HIÁNYZÓ tárolt kód a FIÓKRA mutat, és felkínálja a kiutat", () => {
    /*
      Ez az eset nem a beiro hibaja: a munkatarshoz nincs kod rogzitve. A mondat
      ezert az irodara mutat, ES megnevezi az "egyik sem" agat -- kulonben a
      szerelo ott all az ugyfellel, es nem tud tovabbmenni.
    */
    const message = describeSigningCodeFailure("missing-code");
    assert.match(message, /Szólj az irodának/);
    assert.match(message, /egyik sem/);
  });

  it("az ELTÉRŐ kód is felkínálja a kiutat, de MÁS okból", () => {
    // Itt a fiok rendben van: az ott allo ember nem tudja a kodot. A szerelonek
    // ugyanaz a kijarata, de a mondat NEM az irodara mutat.
    const message = describeSigningCodeFailure("mismatch");
    assert.match(message, /nem egyezik/);
    assert.doesNotMatch(message, /Szólj az irodának/);
  });
});
