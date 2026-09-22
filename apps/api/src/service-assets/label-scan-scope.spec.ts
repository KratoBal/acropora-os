import { readFileSync } from "node:fs";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * A MATRICAKODOS KERESES TULAJDONT ELLENORIZ -- ES EZT KULON KELL ORIZNI.
 *
 * MIERT NEM ELEG A MEGLEVO `partner-scope-and-branch.spec.ts`. Az azt allitja,
 * hogy AMIKOR egy hatokor-segedet HIVUNK, az `AND` agban alljon. Azt nem, hogy
 * hivni KELL. Lemertem (2026-09-02): a `detailByLabelCode` lekerdezesbol
 * KITOROLTEM a hatokor-szurot, es a teljes api csomag ZOLD maradt -- 1752
 * lefutott teszt, nulla piros. Egy orzo, ami a hasznalat MODJAT nezi, nem latja
 * a hasznalat HIANYAT.
 *
 * MI PIROSIT: ha valaki kiveszi a hatokort ebbol a lekerdezesbol. Az a
 * valtozas mukodonek latszana -- a beolvasas tovabbra is megtalalna az
 * eszkozt --, es CSAK annyi tortenne, hogy egy partner mas partnerek eszkozeit
 * is elerne. A matricakod ot karakter, tehat vegigprobalhato.
 *
 * MIERT FORRAS-ALAKU ALLITAS ES NEM VISELKEDES: a viselkedeset az
 * `asset-label.integration.spec.ts` meri, de ahhoz adatbazis kell, es az CSAK a
 * CI-ben fut. Ez a sor a fejlesztes kozben is elsul.
 */
const REPO = "src/service-assets/service-assets.repository.ts";

function forras(): string {
  return readFileSync(REPO, "utf8");
}

/**
 * A MEGJEGYZESEK NELKULI SZOVEG.
 *
 * MIERT KELL, ES EZ MERT ESET (2026-09-22): a "nem visel helyszin-tengelyt"
 * allitas a `departmentId` szora nez. A metodus folott alló jegyzet MAGA is
 * leirja ezt a szot -- a sajat indoklasunkban --, tehat a nyers forrason az
 * allitas SAJAT MAGATOL pirosodott ki.
 *
 * Egy forras-olvaso allitas a KOMMENTEKET is latja, es ez mindket iranyban
 * baj: egy magyarazo bekezdes HAMIS bukast tud okozni, egy masik esetben pedig
 * HAMIS ZOLDET (ha epp a keresett alakot idezi).
 */
function kommentNelkul(szoveg: string): string {
  return szoveg.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

/** Egy metodus torzse a szignaturatol a kovetkezo metodus kezdeteig. */
function metodusTorzs(source: string, nev: string): string {
  const start = source.indexOf(`async ${nev}(`);
  assert.notEqual(start, -1, `${nev} nincs a ${REPO} fajlban`);
  const rest = source.slice(start + 1);
  const next = rest.search(/\n {2}(?:async |\/\*\*)/);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("a matricakódos keresés hatóköre", () => {
  /**
   * A HELYSZIN-TENGELY IS ITT ALL -- ES A DONTES EGY NAPON BELUL KETSZER FORDULT,
   * EZERT AZ INDOKA IS ITT ALL.
   *
   * ELOSZOR bekerult (a matricakod 260 ezer lehetoseg, tehat vegigprobalhato).
   * AZTAN kivettem, mert a kozos tulajdon-szuro (`scopeWhereForAndBranch`)
   * vevo-hatokornel csak vevo-tulajdonu sorra illeszkedik, vevo-tulajdonu
   * sornak viszont SOHA nincs helyszine -- a ketto egyutt nullazta volna ezt az
   * utat.
   * VEGUL a TELJES lathatosagi fuggveny kerult ide a kozos szuro HELYETT
   * (acrobot dontese, 2026-09-22 12:11), es ezzel a helyszin-tengely is
   * ertelmet nyert: az ut mostantol pontosan annyit lat, amennyit a lista.
   *
   * AMI EZT NEM TAGITASSA TESZI: elesben 83 eszkozbol 0 vevo-tulajdonu, tehat
   * ez az ut partnernek MA IS nullat ad. Nem elvettunk egy mukodo dolgot, hanem
   * osszehangoltunk egy halottat a listaval.
   */
  it("a detailByLabelCode a TELJES láthatósági szűrőt használja, AND ágban", () => {
    const torzs = kommentNelkul(metodusTorzs(forras(), "detailByLabelCode"));
    assert.match(
      torzs,
      /assetVisibilityForAndBranch\(scope, assignedUnitIds\)/,
    );
    assert.match(torzs, /AND:\s*\[/);
  });

  /**
   * ES A KOZOS SZURO MAR NEM ALL ITT -- KULON ALLITAS, hogy a csere ne tudjon
   * csendben visszafordulni. A ketto KULON romolhat el: valaki visszateheti a
   * kozos szurot a teljes fuggveny MELLE, es akkor a fenti allitas zold marad,
   * mikozben az ut ujra a szukebb tulajdon-feltetelen all.
   */
  it("a detailByLabelCode NEM használja a KÖZÖS szűrőt", () => {
    const torzs = kommentNelkul(metodusTorzs(forras(), "detailByLabelCode"));
    assert.equal(
      /scopeWhereForAndBranch\(/.test(torzs),
      false,
      "a címke-út visszakapta a közös szűrőt -- olvasd el a tároló jegyzetét",
    );
  });

  /**
   * A QR-UT 2026-09-22 OTA SZUR, ES EZ EGY LEIRT SPEC-DONTEST IR FELUL.
   *
   * Amit felulir: "A TULAJDONOST SZANDEKOSAN NEM ELLENORIZZUK (spec 4.1): a
   * token maga a kulcs." Aki felulirta: Balazs, 2026-09-22 08:55:25 UTC
   * (Discord, uzenet 1551879584851431436), szo szerint "ne lassa" -- arra a
   * kerdesre, hogy a partner embere egy NEM hozza rendelt helyszinen beolvasva
   * lassa-e az eszkozt.
   *
   * A TELJES LATHATOSAGI FUGGVENY ALL ITT, nem csak a helyszin-tengely: igy a
   * beolvasott eszkoz PONTOSAN annyira lathato, mint amennyire a listan lenne.
   * Egy kulon szabaly ezen az uton ugyanaz a szetcsuszas lenne, ami a 671f87f0-t
   * okozta (a lista mutatta, az adatlap nemet mondott).
   */
  it("a detailByQrToken a teljes láthatósági szűrőt AND ágban használja", () => {
    const torzs = metodusTorzs(forras(), "detailByQrToken");
    assert.match(
      torzs,
      /assetVisibilityForAndBranch\(scope, assignedUnitIds\)/,
    );
    assert.match(torzs, /AND:\s*\[/);
  });

  /**
   * ISMERT POZITIV KONTROLL A METODUS-KIVAGASRA -- ES AZ ALAPJA MA MASODSZOR
   * VALTOZOTT, EZERT MOST A LEGSZILARDABB JELRE TESZEM.
   *
   * A fenti allitasok szoveg-darabokon allnak. Ha a kivagas az egesz fajlt adna
   * vissza, minden metodus "hasznalja a hatokort" lenne, mert valahol a fajlban
   * all helper-hivas.
   *
   * AMI KETSZER ELROMLOTT MA: a kontroll eloszor azon allt, hogy a QR-ut NEM
   * szur (Balazs felulirta), aztan azon, hogy a ket ut KULONBOZO fuggvenyt
   * hasznal (a cimke-ut megkapta ugyanazt). Mindket alap egy DONTESEN allt --
   * es a dontes valtozott.
   *
   * AMI NEM FOG VALTOZNI: a ket metodus a SAJAT KULCSARA keres. A cimke-ut a
   * `label: { code }` alakra, a QR-ut a `qrToken` mezore -- es EGYIK SEM
   * tartalmazza a masikét. Ez a kettéválasztás nem izles kerdese: a ket
   * vegpont letezesenek OKA.
   */
  it("a metódus-kivágás tényleg egy metódust ad, nem az egész fájlt", () => {
    const cimke = kommentNelkul(metodusTorzs(forras(), "detailByLabelCode"));
    const qr = kommentNelkul(metodusTorzs(forras(), "detailByQrToken"));

    // MINDEGYIK A SAJATJAT TARTALMAZZA (ismert pozitiv: a kivagas nem ures)
    assert.match(cimke, /label: \{ code \}/);
    assert.match(qr, /qrToken/);

    // ES EGYIK SEM A MASIKET (ha a kivagas tul sokat adna, mindketto latszana)
    assert.equal(
      /qrToken/.test(cimke),
      false,
      "a címke-út törzsében qrToken látszik -- a kivágás túl sokat adott vissza",
    );
    assert.equal(
      /label: \{ code \}/.test(qr),
      false,
      "a QR-út törzsében a címke-kulcs látszik -- a kivágás túl sokat adott vissza",
    );
  });
});
