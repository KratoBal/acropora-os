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
   * ISMERT POZITIV KONTROLL A METODUS-KIVAGASRA.
   *
   * A fenti allitas egy SZOVEGDARABON all, amit egy sajat fuggveny vag ki. Ha a
   * kivagas elromlana es URES sztringet adna, a `match` pirosodna -- de ha
   * TULSAGOSAN sokat adna vissza (peldaul az egesz fajlt), a fenti allitas
   * akkor is zold lenne, HOLOTT nem ezt a metodust meri. Ez a sor azt zarja ki:
   * a `detailByQrToken` SZANDEKOSAN nem ellenorzi a tulajdont, tehat a
   * kivagasnak azt a metodust hatokor-szuro NELKUL kell visszaadnia.
   */
  it("a metódus-kivágás tényleg egy metódust ad, nem az egész fájlt", () => {
    const torzs = metodusTorzs(forras(), "detailByQrToken");
    assert.equal(
      /scopeWhereForAndBranch\(scope\)/.test(torzs),
      false,
      "a detailByQrToken szándékosan nem szűr tulajdonra -- ha itt találat van, a kivágás túl sokat adott vissza",
    );
  });
});
