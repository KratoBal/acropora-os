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

/** Egy metodus torzse a szignaturatol a kovetkezo metodus kezdeteig. */
function metodusTorzs(source: string, nev: string): string {
  const start = source.indexOf(`async ${nev}(`);
  assert.notEqual(start, -1, `${nev} nincs a ${REPO} fajlban`);
  const rest = source.slice(start + 1);
  const next = rest.search(/\n {2}(?:async |\/\*\*)/);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("a matricakódos keresés hatóköre", () => {
  it("a detailByLabelCode a hatókör-szűrőt AND ágban használja", () => {
    const torzs = metodusTorzs(forras(), "detailByLabelCode");
    assert.match(torzs, /scopeWhereForAndBranch\(scope\)/);
    assert.match(torzs, /AND:\s*\[/);
  });

  /**
   * A HELYSZIN-TENGELY KULON ALLITAST KAP, ES EZ NEM ISMETLES.
   *
   * A fenti allitas a TULAJDON-szurot nezi. A ketto KULON tud eltunni: a
   * matricakod 260 ezer lehetoseg, tehat vegigprobalhato, es a tulajdon-szuro
   * MEGLETE mellett is a sajat ugyfel MASIK helyszinet adna vissza -- pontosan
   * azt, amit a gazda kizart (2026-09-22 07:46:59 UTC).
   *
   * A SAJAT AG, ES NEM A KOZOS FUGGVENY: a `scopeWhereForAndBranch` kozos a
   * munkalapokkal, a hibajegyekkel es a partner-listaval. Egy szukites ott
   * mindegyik hivojanak megvaltoztatna a jelenteset.
   */
  it("a detailByLabelCode a HELYSZIN-tengelyt is AND ágban használja", () => {
    const torzs = metodusTorzs(forras(), "detailByLabelCode");
    assert.match(torzs, /egysegTengelyAsset\(scope, assignedUnitIds\)/);
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
   * ISMERT POZITIV KONTROLL A METODUS-KIVAGASRA -- ES A PREMISSZAJA 2026-09-22-EN
   * MEGVALTOZOTT, EZERT VAN ATIRVA.
   *
   * AMI ITT ALLT: a kontroll arra epult, hogy a `detailByQrToken` SZANDEKOSAN
   * nem szur tulajdonra, tehat a kivagasnak hatokor-szuro nelkuli torzset kell
   * adnia. Ez a premissza ma mar HAMIS -- a QR-ut szur.
   *
   * AZ ALLITAS ATTOL MEG ZOLD MARADT VOLNA (a QR-ut a masik fuggvenyt hasznalja,
   * nem a `scopeWhereForAndBranch`-et), es EPP EZ A VESZELYES: egy kontroll,
   * aminek az INDOKA hamis, ugyanugy mukodik, csak senki nem tudja, mit meri.
   *
   * AZ UJ PREMISSZA MERT, NEM FELTETELEZES: a ket ut SZANDEKOSAN KULONBOZO
   * fuggvenyt hasznal. A cimke-ut a KOZOS szurot plusz a sajat helyszin-agat, a
   * QR-ut a TELJES lathatosagi fuggvenyt. Ha a kivagas az egesz fajlt adna
   * vissza, MINDKET nev megjelenne MINDKET torzsben -- tehat a ket tagadas
   * egyutt bizonyitja, hogy a kivagas metodusonkent vag.
   */
  it("a metódus-kivágás tényleg egy metódust ad, nem az egész fájlt", () => {
    assert.equal(
      /assetVisibilityForAndBranch\(/.test(
        metodusTorzs(forras(), "detailByLabelCode"),
      ),
      false,
      "a címke-út a KÖZÖS szűrőt használja, nem a teljes láthatósági függvényt -- ha itt találat van, a kivágás túl sokat adott vissza",
    );
    assert.equal(
      /scopeWhereForAndBranch\(/.test(
        metodusTorzs(forras(), "detailByQrToken"),
      ),
      false,
      "a QR-út a teljes láthatósági függvényt használja, nem a közöset -- ha itt találat van, a kivágás túl sokat adott vissza",
    );
  });
});
