import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { DOCUMENT_UPLOAD_LIMITS } from "./document-upload-limits.js";

/**
 * A DOKUMENTUM-KERET EGY HELYEN ALL, ES EZ ORZO, NEM CSAK EGY KONSTANS (3420fef3).
 *
 * Harom feluleten allt ugyanaz a ket szam, harom kulon neven -- es a kartya
 * szerint mar haromszor kellett oket EGYSZERRE javitani. Az osszevonas
 * onmagaban nem akadalyozza meg, hogy a kovetkezo felulet UJRA sajat szamot
 * irjon: ahhoz olvasni kell a fat.
 *
 * === ES EGY SZABALY, AMI MINDEN FA-BEJARO ALLITASRA ALL, NEM CSAK ERRE ===
 *
 * Ket tagado allitas UGYANUGY NEZ KI, es megsem egyforma eros:
 *
 *   ami NEM URES listat rogzit   egy vak bejaras OTT IS pirosat ad -- onmagat vedi
 *   ami URES listat var          egy vak bejaras CSENDBEN kielegiti
 *
 * Egy `deepEqual([])` alaku tagadas tehat magatol teljesul, ha a meroeszkoz
 * elromlik: a nulla talalat ugyanugy nez ki, mint a helyes nulla. ODA POZITIV
 * KONTROLL KELL, ami bizonyitja, hogy a bejaras egyaltalan LAT.
 *
 * Ez nem elmelet: lentebb mind a ketto all, es a kalibracio meg is mutatta a
 * kulonbseget (a gyoker elrontasara az elso magatol pirosodott, a masodik nem).
 */
const API = join(new URL("../../", import.meta.url).pathname, "src");

/** A kommentek kiszedese: a sajat magyarazatunk ugyanazokat a szamokat idezi. */
function kodSzoveg(forras: string): string {
  return forras
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}

function fajlok(konyvtar: string, gyujto: string[] = []): string[] {
  for (const b of readdirSync(konyvtar, { withFileTypes: true })) {
    const ut = join(konyvtar, b.name);
    if (b.isDirectory()) fajlok(ut, gyujto);
    else if (ut.endsWith(".ts") && !ut.endsWith(".spec.ts")) gyujto.push(ut);
  }
  return gyujto;
}

describe("a dokumentum-feltöltés kerete", () => {
  it("a két szám egy értéken áll", () => {
    assert.equal(DOCUMENT_UPLOAD_LIMITS.files, 10);
    assert.equal(DOCUMENT_UPLOAD_LIMITS.fileSizeBytes, 10 * 1024 * 1024);
  });

  /**
   * A NYERS MERET-KORLAT NEM TERHET VISSZA EGYETLEN KONTROLLERBE SEM.
   *
   * A minta a `multer` alakjara megy (`fileSize: <szam>`), nem a 10 MB-ra: egy
   * MASIK szammal beirt korlat ugyanugy ketté vinné a keretet, csak nem tunne
   * fel, hogy ugyanaz a szabaly.
   */
  it("egyetlen forrásfájl sem ír saját fileSize korlátot", () => {
    const sajat = fajlok(API)
      .filter((ut) => !ut.endsWith("document-upload-limits.ts"))
      .filter((ut) =>
        /fileSize:\s*\d/.test(kodSzoveg(readFileSync(ut, "utf8"))),
      )
      .map((ut) => ut.slice(API.length));

    /*
      A LELTAR- ES UNAS-IMPORT 25 MB-os kerete MAS keret: ott EGY tablazat
      erkezik, nem kep. Nevesitve all itt, hogy a lista ne nemuljon el toluk --
      es hogy ha egyszer UJ nev kerul ide, az LATSZIK.
    */
    assert.deepEqual(sajat, [
      "/imports/unas/unas-import.controller.ts",
      "/inventory/inventory-count.controller.ts",
    ]);
  });

  /**
   * ES A DARABSZAM SEM. A harom regi konstans (`MAX_*_DOCUMENTS_PER_UPLOAD`)
   * kivezetve; ha barmelyik visszater, ez az allitas szol.
   */
  it("egyetlen forrásfájl sem tart saját darabszám-konstanst", () => {
    const sajat = fajlok(API)
      .filter((ut) =>
        /MAX_\w*DOCUMENTS_PER_UPLOAD/.test(kodSzoveg(readFileSync(ut, "utf8"))),
      )
      .map((ut) => ut.slice(API.length));

    assert.deepEqual(sajat, []);
  });

  /*
    ISMERT POZITIV KONTROLL, ES A KALIBRACIO PONTOSITOTTA, MIRE KELL.

    Azt vartam, hogy egy elrontott gyoker mellett MIND A KET fenti tagadas zold
    marad. Merve: NEM igy van, es a kulonbseg a ket allitas ALAKJABOL jon.

      a fileSize-allitas    egy NEM URES listat rogzit (a ket nevesitett
                            kivetel), tehat egy vak bejaras ott is pirosat ad
                            -- ez az allitas ONMAGAT is vedi
      a darabszam-allitas   URES listat var, tehat egy vak bejaras CSENDBEN
                            kielegiti

    Vagyis ez a kontroll a MASODIK allitasert all itt, nem mind a kettoert. Egy
    `deepEqual([])` alaku tagadas mindig ilyen: a semmit nem lato meres es a
    tiszta fa ugyanugy nez ki.
  */
  it("a bejárás lát: a közös modult MEGTALÁLJA a fában", () => {
    const mind = fajlok(API);
    assert.ok(mind.length > 200, `gyanúsan kevés forrásfájl: ${mind.length}`);
    assert.ok(
      mind.some((ut) => ut.endsWith("documents/document-upload-limits.ts")),
      "a közös modul nincs a bejárt halmazban",
    );
  });
});
