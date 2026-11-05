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
  it("both documents are drafts with open [KITÖLTENDŐ] marks, and the check says so", () => {
    for (const d of JOGI_DOKUMENTUMOK) {
      assert.ok(kitoltendoDb(d) >= 5, `${d.azonosito}: ${kitoltendoDb(d)}`);
      assert.match(d.vazlat_jelzes, /^VÁZLAT/);
    }
    assert.equal(jogiSzovegVazlat(), true);
  });

  it("every decision that is the owner's stays a mark", () => {
    const szabaly = szoveg(JATEKSZABALYZAT);
    for (const reszlet of ["szervező", "időtartam", "nyeremény", "értesít"]) {
      assert.ok(
        JATEKSZABALYZAT.szakaszok.some(
          (s) =>
            new RegExp(reszlet, "i").test(s.cim) &&
            s.bekezdesek.join().includes("[KITÖLTENDŐ"),
        ),
        reszlet,
      );
    }
    assert.doesNotMatch(szabaly, /Ft\b|forint|EUR|Kft\.|Zrt\./);
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
