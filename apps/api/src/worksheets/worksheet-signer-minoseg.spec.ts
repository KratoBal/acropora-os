import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { worksheetSignerLabel } from "./worksheet-signer.js";

describe("az aláíró minősége a lapon", () => {
  it("a három ág HÁROM KÜLÖNBÖZŐ mondatot kap", () => {
    /*
      A KULONBOZOSEG AZ ALLITAS, nem a konkret szoveg. Ha ketto kozuluk
      egyforma lenne, a lap epp azt nem mondana meg, amiert ez a modul letezik:
      hogy KI irta ala -- a partner embere, egy helyszinen beirt nev, vagy a mi
      sajat kollegank.
    */
    const feliratok = [
      worksheetSignerLabel("SELECTED"),
      worksheetSignerLabel("TYPED"),
      worksheetSignerLabel("INTERNAL"),
    ];
    assert.equal(new Set(feliratok).size, 3, feliratok.join(" | "));
  });

  it("a BELSŐS aláírás kimondja, hogy a SZOLGÁLTATÓ embere", () => {
    /*
      MI PIROSIT: ha valaki a belsos agra a semleges "Alairta" mondatot teszi.
      A lap akkor tobbet allitana, mint ami tortent: az olvaso ugyfel-alairasnak
      venne.
    */
    assert.match(worksheetSignerLabel("INTERNAL"), /szolgáltató/);
  });

  it("a KÉZZEL BEÍRT név kimondja magát", () => {
    assert.notEqual(worksheetSignerLabel("TYPED"), "Aláírta");
    assert.match(worksheetSignerLabel("TYPED"), /beírt|helyszín/);
  });

  it("a RÉGI sorok minősítés NÉLKÜL maradnak", () => {
    /*
      A sema sajat megjegyzese mondja ki: ahol a `signerSource` ures, ott a
      regi, ketertelmu allapot van, es "egy kitalalt ertek rosszabb, mint egy
      ketertelmu".

      MI PIROSIT: ha valaki a `null`-t is minositi. Az visszamenoleg allitana
      valamit tobb szaz regi alairasrol, amit senki nem mert meg.
    */
    assert.equal(worksheetSignerLabel(null), "Aláírta");
    assert.equal(worksheetSignerLabel(undefined), "Aláírta");
  });

  it("egy ISMERETLEN érték a SEMLEGES mondatot kapja, nem egy rosszat", () => {
    /*
      POZITIV KONTROLL A DEFAULT AGRA. Enelkul a fenti allitas ugy is teljesulne,
      hogy a default ag egyaltalan nem erheto el -- es akkor egy negyedik
      enum-ertek nem a semleges mondatot kapna, hanem vegigesne a switch aljan.
    */
    assert.equal(worksheetSignerLabel("EZ_NINCS" as never), "Aláírta");
  });
});
