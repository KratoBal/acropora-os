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
  it("the rules are final (Balázs's text, 2026-11-06): no draft warning and no open mark; the privacy notice is still a draft, and the check says so", () => {
    assert.equal(JATEKSZABALYZAT.vazlat_jelzes, undefined);
    assert.equal(kitoltendoDb(JATEKSZABALYZAT), 0);
    assert.ok(
      kitoltendoDb(ADATKEZELES) >= 5,
      String(kitoltendoDb(ADATKEZELES)),
    );
    assert.match(ADATKEZELES.vazlat_jelzes ?? "", /^VÁZLAT/);
    // a vázlat-jelzés addig igaz, amíg a tájékoztatón egy jelölés is nyitva van
    assert.equal(jogiSzovegVazlat(), true);
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
      "A Fődij sorsolása 2026 december 26-án este 22:00 órakor történik.",
      "A játékban bárki résztvehet, aki a játék kezdetekor betöltötte a 18. életévét.",
      "A játékos megadja a nevét, az e-mail-címét és a válaszát.",
    ])
      assert.ok(szabaly.includes(mondat), mondat);
    assert.equal(szabaly.includes("[KITÖLTENDŐ"), false);
  });

  it("the rules say a re-run draw only checks: the first recorded result counts (barracuda's question, 2026-11-05)", () => {
    const szabaly = szoveg(JATEKSZABALYZAT);
    assert.match(
      szabaly,
      /újra lefuttatnak, mindig az első, rögzített eredmény számít; az újrafuttatás csak ellenőrzés/,
    );
  });

  it("every decision of the privacy notice that is the owner's stays a mark", () => {
    const adat = szoveg(ADATKEZELES);
    for (const resz of [
      "adatkezelő",
      "jogalap",
      "őrizzük",
      "adatfeldolgoz",
      "jogaid",
    ])
      assert.match(adat, new RegExp(resz, "i"), resz);
    assert.doesNotMatch(adat, /GDPR|6\. cikk|Infotv|NAIH/);
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
