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

  /**
   * A KAPU EREDMENYET SENKI NEM MERTE -- EZ A KET ALLITAS ZARJA BE.
   *
   * === A MERT RES (2026-09-22) ===
   *
   * A fenti harom allitas azt mondja, hogy a ket HIVAS ott van a fajlban. Ott is
   * volt. Amit egyik sem mondott: hogy az iteletukkel TORTENIK-E VALAMI.
   *
   * Lemertem, nem kovetkeztettem: kivettem a kepernyorol az egyetlen sort, ami
   * a kaput ervenyesiti (`if (!kapu.mayProceed) throw ...`), es lefuttattam
   * mindent. Az api keszlet 3480 tesztje, a mobil 1266 tesztje, a mobil
   * typecheck es lint MIND ZOLD maradt. Negyezer-hetszaznegyvenhat lefutott
   * teszt, es egyik sem szolalt meg.
   *
   * Az a valtozas azt jelenti, hogy a telefon lefuttatja a biometrikus
   * azonositast, ELDOBJA az iteletet, es alairja a munkalapot.
   *
   * === MIERT KET ALLITAS, ES MIERT NEM EGY ===
   *
   * Ket kulonbozo romlas van, es egy allitas osszemosna oket:
   *   a SORREND     -- az ellenorzes az alairas UTANRA csuszik
   *   a MEGALLITAS  -- az ellenorzes a helyen marad, de mar nem dob
   * Igy mindegyikhez SAJAT rontas tartozik, es nev szerint valik szet, melyik
   * romlott el.
   *
   * A torzset a `signSelf` mutaciora szukitem, mert a `signWorksheet` a fajlban
   * HAROM helyen all: az importban es a MASIK mutacioban is. A teljes fajlra
   * mert sorrend a rossz part hasonlitana ossze.
   */
  it("a kapu ellenőrzése MEGELŐZI az aláírást, ugyanabban a függvényben", () => {
    const kezd = kod.indexOf("const signSelf = useMutation({");
    assert.ok(kezd >= 0, "nem találom a signSelf mutációt a képernyőn");
    const veg = kod.indexOf("\n  const ", kezd + 1);
    assert.ok(veg > kezd, "nem találom a signSelf mutáció végét");
    const torzs = kod.slice(kezd, veg);

    const ellenorzes = torzs.indexOf("mayProceed");
    const alairas = torzs.indexOf("signWorksheet(");
    assert.ok(
      ellenorzes >= 0,
      "a signSelf nem olvassa a kapu mayProceed mezőjét",
    );
    assert.ok(alairas >= 0, "a signSelf nem hívja a signWorksheet-et");

    assert.ok(
      ellenorzes < alairas,
      "a kapu ellenőrzése az ALÁÍRÁS UTÁN áll: a lap már elment, mire kiderül",
    );
  });

  it("a kapu ellenőrzése MEG IS ÁLLÍT, nem csak lefut", () => {
    /*
      MI PIROSIT: ha az `if (!kapu.mayProceed)` a helyen marad, de a torzse mar
      nem dob -- peldaul csak egy uzenetet ir ki. Az ellenorzes ekkor LEFUT, a
      sorrend HELYES, es az alairas megis vegigmegy. A sorrend-allitas erre vak,
      ezert all itt kulon.
    */
    const kezd = kod.indexOf("const signSelf = useMutation({");
    const veg = kod.indexOf("\n  const ", kezd + 1);
    const torzs = kod.slice(kezd, veg);

    assert.match(
      torzs,
      /if\s*\(\s*!\s*\w+\.mayProceed\s*\)\s*throw\b/,
      "a mayProceed ellenőrzése nem ÁLLÍT MEG semmit: az aláírás enélkül is végigmegy",
    );
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
