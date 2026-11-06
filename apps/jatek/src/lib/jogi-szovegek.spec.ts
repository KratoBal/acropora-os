import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ADATKEZELES,
  JATEKSZABALYZAT,
  JOGI_DOKUMENTUMOK,
  jogiSzovegVazlat,
  kitoltendoDb,
} from "./jogi-szovegek.ts";

/*
  WHAT TURNS THIS RED. A legal or business decision written as if it were made (the organiser, the prizes, the
  duration, the legal basis, the retention, the processors, the data subject's rights are the owner's: each one
  stays a [KITÖLTENDŐ]); the draft going out without its warning; the page promising a newsletter, or saying less
  than the brief decided (only the correct answers are drawn, once a week per address, confirmation by link).
*/
const szoveg = (d: (typeof JOGI_DOKUMENTUMOK)[number]) =>
  d.szakaszok.flatMap((s) => [s.cim, ...s.bekezdesek]).join("\n");

describe("a jogi szoveg vazlatai", () => {
  it("both documents are final (Balázs's texts, 2026-11-06): no draft warning and no open mark, and the draft check says so", () => {
    for (const d of JOGI_DOKUMENTUMOK) {
      assert.equal(d.vazlat_jelzes, undefined, d.azonosito);
      assert.equal(kitoltendoDb(d), 0, d.azonosito);
    }
    assert.equal(jogiSzovegVazlat(), false);
  });

  it("the draft machinery still works for a text that is not final: an open mark is counted", () => {
    const vazlat = {
      azonosito: "adatkezeles" as const,
      cim: "x",
      szakaszok: [{ cim: "1. x", bekezdesek: ["[KITÖLTENDŐ: valami]"] }],
    };
    assert.equal(kitoltendoDb(vazlat), 1);
  });

  it("the rules are the owner's eight sections word for word: his title lines, the organiser, the schedule, the draw and the name asked of a player", () => {
    assert.deepEqual(
      JATEKSZABALYZAT.szakaszok.map((s) => s.cim),
      [
        "1. A játék szervezője",
        "2. A játék időtartama",
        "3. Ki vehet részt",
        "4. Hogyan lehet részt venni",
        "5. A válasz értékelése",
        "6. A sorsolás",
        "7. A nyertesek értesítése",
        "8. Adatkezelés",
      ],
    );
    const szabaly = szoveg(JATEKSZABALYZAT);
    for (const mondat of [
      "Acropora Kft.",
      "Adószám: 23916229-2-42",
      "A játék 2026 november 7-én 22:00 órakor kezdődik.",
      "A Fődíj sorsolása 2026 december 26-án este 22:00 órakor történik.",
      "A játékban bárki részt vehet, aki a játék kezdetekor betöltötte a 18. életévét.",
      "A játékos megadja a nevét, az e-mail-címét és a válaszát.",
    ])
      assert.ok(szabaly.includes(mondat), mondat);
    assert.equal(szabaly.includes("[KITÖLTENDŐ"), false);
  });

  it("the rules differ from the owner's file in exactly these places: two sentences he asked to add (the prize, the published name) and two typos of the schedule corrected", () => {
    const szabaly = szoveg(JATEKSZABALYZAT);
    for (const mondat of [
      "A fődíj egy Aquaforest AF Nano Tank akvárium. A képeken látható dekoráció és élővilág nem része a nyereménynek. A heti nyereményt az adott heti kérdéssel együtt tesszük közzé a játék oldalán.",
      "A nyertes nevét rövidített alakban (vezetéknév és a keresztnév kezdőbetűje, például Kovács P.) közzétesszük a játék oldalán.",
      "A hatodik hét kérdése 2026 december 12 22:00 órakor jelenik meg",
      "A hetedik hét kérdése 2026 december 19 22:00 órakor jelenik meg",
    ])
      assert.ok(szabaly.includes(mondat), mondat);
    assert.equal(szabaly.includes("Az hatodik"), false);
    assert.equal(szabaly.includes("Az hetedik"), false);
    // two more obvious slips, corrected on acrobot's word (44311): "Fődij" and "résztvehet"
    assert.equal(szabaly.includes("Fődij"), false);
    assert.equal(szabaly.includes("résztvehet"), false);
    assert.equal(szabaly.split("A Fődíj sorsolása").length - 1, 2);
    // the prize sentences close section 6, the name sentence closes section 7
    assert.match(
      JATEKSZABALYZAT.szakaszok[5]!.bekezdesek.at(-1)!,
      /^A fődíj egy Aquaforest AF Nano Tank/,
    );
    assert.match(
      JATEKSZABALYZAT.szakaszok[6]!.bekezdesek.at(-1)!,
      /^A nyertes nevét rövidített alakban/,
    );
  });

  it("the rules say a re-run draw only checks: the first recorded result counts (barracuda's question, 2026-11-05)", () => {
    const szabaly = szoveg(JATEKSZABALYZAT);
    assert.match(
      szabaly,
      /újra lefuttatnak, mindig az első, rögzített eredmény számít; az újrafuttatás csak ellenőrzés/,
    );
  });

  it("the privacy notice is the owner's four sections word for word, plus one sentence he asked for: the shortened winner's name is published", () => {
    assert.deepEqual(
      ADATKEZELES.szakaszok.map((x) => x.cim),
      [
        "1. Az adatkezelő",
        "2. Milyen adatokat kezelünk",
        "3. Mire használjuk",
        "4. Mennyi ideig őrizzük",
      ],
    );
    const adat = szoveg(ADATKEZELES);
    for (const mondat of [
      "Acropora Kft.",
      "Adószám: 23916229-2-42",
      "A nevedet, e-mail-címedet, a beküldött válaszodat, azt, hogy melyik kérdésre és mikor küldted be, valamint a megerősítés tényét és idejét.",
      "Az adataidat a fődíj sorsolását követő maximum 15 nappal töröljük rendszerünkből",
    ])
      assert.ok(adat.includes(mondat), mondat);
    // the one added sentence (acrobot 44299), the last of section 3
    assert.equal(
      ADATKEZELES.szakaszok[2]!.bekezdesek.at(-1),
      "Ha nyersz, a nevedet rövidített alakban (vezetéknév és a keresztnév kezdőbetűje, például Kovács P.) közzétesszük a játék oldalán.",
    );
  });

  it("the rules say what the page does: correct answers only, once a week, confirmation by link, more weeks more chances", () => {
    const szabaly = szoveg(JATEKSZABALYZAT);
    assert.match(szabaly, /Csak a helyes válasz kerül a sorsolásba/);
    assert.match(szabaly, /hetente egyszer/);
    assert.match(szabaly, /megerősítő linkre kattint/);
    assert.match(szabaly, /annyiszor szerepel/);
    assert.match(szabaly, /nem kap visszajelzést/);
  });

  it("the e-mail address is for the game and the winner's notice only: no newsletter, anywhere", () => {
    const mind = JOGI_DOKUMENTUMOK.map(szoveg).join("\n");
    assert.match(szoveg(ADATKEZELES), /hírlevélre sem használjuk/);
    assert.match(szoveg(ADATKEZELES), /nincs hírlevélre feliratkozás/);
    // every sentence that names the newsletter denies it
    for (const mondat of mind
      .split(/(?<=\.)\s+|\n/)
      .filter((m) => /hírlevél/i.test(m)))
      assert.match(
        mondat,
        /(^|[^a-záéíóöőúüű])(nem|sem|nincs)([^a-záéíóöőúüű]|$)/i,
        mondat,
      );
  });

  it("the sections are numbered in order and none is empty", () => {
    for (const d of JOGI_DOKUMENTUMOK) {
      d.szakaszok.forEach((s, i) => {
        assert.match(s.cim, new RegExp(`^${i + 1}\\. `), d.azonosito);
        assert.ok(s.bekezdesek.length > 0);
        for (const b of s.bekezdesek) assert.ok(b.trim().length > 0);
      });
    }
  });
});
