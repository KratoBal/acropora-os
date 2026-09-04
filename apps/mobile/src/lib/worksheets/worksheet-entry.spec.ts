import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildWorksheetEntry,
  describeEmptyEntries,
  worksheetEntryByline,
} from "./worksheet-entry";

/**
 * A MUNKANAPLO DONTESEI, A KEPERNYOTOL KULON.
 *
 * Az appban nincs komponens-teszt: ami a torzsben marad, azt csak kezzel,
 * telefonon lehet kiprobalni -- egy bejegyzesnel a helyszinen, munka kozben.
 */

const iso = (s: string) => s;

describe("mit fogadunk el bejegyzésnek", () => {
  it("a CSUPA SZÓKÖZ nem bejegyzés", () => {
    /*
      Egy ures bejegyzes sort foglalna a listan, szerzot es idopontot kapna, es
      ugy nezne ki, mintha valaki dolgozott volna. A szerver ugyanigy szur a
      LEVAGOTT szovegen -- ha ez a kapu atengedne, a szerelo egy technikai
      hibauzenetet latna a sajat ures mezoje helyett.

      MI PIROSIT: a levagas elhagyasa (`input.length > 0` a nyers szovegen).
    */
    const out = buildWorksheetEntry("    ");
    assert.equal(out.ok, false);
    assert.match(out.message ?? "", /Írd le/);
  });

  it("a szöveget LEVÁGVA adja tovább", () => {
    // A kornyezo szokoz nem tartalom, es a szerveren a hosszt is az dontene el.
    const out = buildWorksheetEntry("  Szivattyú csere  ");
    assert.equal(out.ok, true);
    assert.equal(out.body, "Szivattyú csere");
  });

  it("a FELSŐ HATÁR a szerveré, és a mondat megmondja, mennyivel több", () => {
    /*
      Egy puszta "tul hosszu" mellett a szerelo nem tudja, mennyit kell
      torolnie. MI PIROSIT: a szam elhagyasa az uzenetbol, vagy egy MAS hatar,
      mint amit a szerver ismer (4000).
    */
    const out = buildWorksheetEntry("x".repeat(4001));
    assert.equal(out.ok, false);
    assert.match(out.message ?? "", /4000/);
    assert.match(out.message ?? "", /4001/);
  });
});

describe("ki és mikor írta", () => {
  it("az ISMERETLEN szerzőt KIMONDJA, nem hagyja üresen", () => {
    /*
      A szerzo azonositoja a szerveren `SetNull` a torleskor: a bejegyzes
      megmarad, a nev nelkul. Egy ures hely a nev helyen betoltesi hibanak
      latszik.

      MI PIROSIT: egy ures sztringre eses (`authorName ?? ""`).
    */
    const line = worksheetEntryByline(
      { authorName: null, createdAt: "A", updatedAt: "A" },
      iso,
    );
    assert.match(line, /Ismeretlen szerző/);
  });

  it("a SZERKESZTÉST kimondja, ha volt", () => {
    /*
      Egy atirt bejegyzes ugyanugy nez ki, mint az eredeti, es aki a lapot
      olvassa, nem tudja megkulonboztetni. A ket idopont osszevetese az
      EGYETLEN jel.

      MI PIROSIT: az `updatedAt` figyelmen kivul hagyasa.
    */
    const line = worksheetEntryByline(
      { authorName: "Szerelő Sándor", createdAt: "A", updatedAt: "B" },
      iso,
    );
    assert.match(line, /szerkesztve B/);
  });

  it("az ÉRINTETLEN bejegyzésen NINCS szerkesztés-jelölés", () => {
    /*
      TESTVER-KONTROLL: egy valtozat, ami MINDIG kiirja a szerkesztest, a fenti
      allitason atmenne -- es akkor minden bejegyzes atirtnak latszana, tehat a
      jelzes semmit nem mondana.
    */
    const line = worksheetEntryByline(
      { authorName: "Szerelő Sándor", createdAt: "A", updatedAt: "A" },
      iso,
    );
    assert.doesNotMatch(line, /szerkesztve/);
  });
});

describe("az üres lista mondata", () => {
  it("aki ÍRHAT, biztatást kap", () => {
    assert.match(describeEmptyEntries(true), /Írd le/);
  });

  it("aki NEM írhat, nem kap felszólítást olyanra, amit nem tud megtenni", () => {
    // MI PIROSIT: kozos szoveg a ket agra. Egy "Ird le, mit csinaltal"
    // felszolitas ott, ahol nincs gomb, ugy nez ki, mint hiba a programban.
    assert.doesNotMatch(describeEmptyEntries(false), /Írd le/);
  });
});
