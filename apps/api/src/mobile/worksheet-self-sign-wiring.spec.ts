import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { maskCommentsAndStrings } from "../testing/source-mask.js";

/**
 * A SAJÁT ALÁÍRÁS GOMBJA TÉNYLEG A KAPUN MEGY ÁT, ÉS TÉNYLEG `signSelf`-ET KÜLD.
 *
 * === MIÉRT KELL ERRE ÁLLÍTÁS ===
 *
 * A döntés (`worksheet-self-signature.ts`) tiszta modul, és a saját specje méri.
 * Amit az NEM mér: hogy a képernyő HASZNÁLJA-e. Ez a szakadás alakja -- mind a
 * két oldal helyes önmagában, csak senki nem hívja --, és a szakadást nem lehet
 * a kód átolvasásával megtalálni, mert nincs mit észrevenni.
 *
 * KÉT MÓD, AHOGY EZ NÉMÁN ELROMLIK:
 *
 * 1. A gomb a biometrikus kapu NÉLKÜL ír alá. Minden zöld, a lap aláírva -- és
 *    az azonosítás, amit Balázs kért, egyszerűen nem történik meg.
 * 2. A gomb `signSelf` nélkül küld. Ekkor a szerver a NÉV nélküli ágra fut, és
 *    elutasítja; a hiba hangos, de csak telefonon.
 *
 * === MIÉRT AZ API OLDALÁN ===
 *
 * Ugyanaz az ok, amiért a `mobile-screen-routes.spec.ts` is itt ül: egy őrző,
 * ami abban a fordítási halmazban él, amit őriznie kell, a halmaz szűkítésekor
 * kiesik vele együtt, és zöld marad.
 *
 * === AMIT EZ NEM BIZONYÍT ===
 *
 * Azt méri, hogy a hívás OTT ÁLL a forrásban, nem azt, hogy futásidőben le is
 * fut. Az appban nulla komponens-teszt van; a sorrendet (előbb a kapu, aztán a
 * küldés) a modul visszatérési értéke kényszeríti ki, nem ez az állítás.
 */

const KEPERNYO = "../mobile/src/app/worksheets/sign/[id].tsx";
const MODUL = "../mobile/src/lib/worksheets/worksheet-self-signature.ts";

function forras(ut: string): string {
  const s = readFileSync(ut, "utf8");
  assert.ok(s.length > 500, `${ut}: üres vagy gyanúsan rövid`);
  return s;
}

describe("a saját aláírás gombja be van kötve", () => {
  const kod = maskCommentsAndStrings(forras(KEPERNYO));

  /**
   * POZITIV KONTROLL: a maszkolás kifehéríti a kommenteket, és a fenti
   * magyarázatok SZÓ SZERINT említik mind a két keresett nevet. Maszk nélkül a
   * saját indoklásunk elégítené ki az állításokat. Ez a kontroll azt méri, hogy
   * a maszkolt szöveg egyáltalán tartalmaz-e kódot.
   */
  it("POZITÍV KONTROLL: a maszkolt forrás kódot tartalmaz", () => {
    assert.match(kod, /useMutation/);
    assert.match(kod, /signWorksheet\(/);
  });

  it("a képernyő a KAPUN át megy, nem közvetlenül aláír", () => {
    /*
      MI PIROSIT: ha a gomb a biometriat kihagyva ir ala. Az a legcsendesebb
      romlas: a lap alairva, minden zold, es az azonositas nem tortenik meg.
    */
    assert.match(kod, /selfSignatureGate\(/);
    assert.match(kod, /unlockWithBiometrics\(/);
  });

  it("`signSelf` megy a szervernek", () => {
    /*
      MI PIROSIT: ha a mezo kimarad. A szerver ekkor a nev nelkuli agra fut es
      elutasit -- a hiba hangos, de CSAK telefonon derul ki.
    */
    assert.match(kod, /signSelf:\s*true/);
  });

  it("a kapu MIND A HÁROM kimenetét kezeli a modul", () => {
    /*
      A KEPERNYO a `mayProceed` mezot olvassa; hogy a harom kimenet tenyleg
      harom kulonbozo valaszt ad, azt a modul sajat specje meri. Itt azt
      allitjuk, hogy a modul egyaltalan ISMERI mind a harmat -- egy negyedik,
      kezeletlen kimenet ugyanis a kepernyon `undefined`-kent viselkedne.
    */
    const modul = maskCommentsAndStrings(forras(MODUL));
    for (const kimenet of ["unlocked", "rejected", "unavailable"])
      assert.match(
        forras(MODUL),
        new RegExp(`case "${kimenet}"`),
        `a modul nem kezeli: ${kimenet}`,
      );
    assert.match(modul, /switch\s*\(/);
  });
});
