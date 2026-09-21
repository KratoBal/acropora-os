import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * A HIBAJEGY-SOR ATKATTINTHATOSAGA A KEPERNYON.
 *
 * === MIERT KELL KULON HALO, HA A MODULNAK MAR VAN SPECJE ===
 *
 * A `worksheetDetailRows` specje azt meri, hogy a sor MEGKAPJA a
 * `serviceJobId`-t. Abbol viszont NEM kovetkezik, hogy a kepernyo hasznalja is:
 * ha a rajzolo tovabbra is sima `Text`-et tenne oda, a modul tesztjei ZOLDEK
 * maradnanak, es a szam ugyanugy nem vinne sehova.
 *
 * Ez nem elmeleti: ma reggel egy MASIK munkaban pontosan igy tettem egy orzot
 * HALOTT AGRA -- a fuggveny sajat tesztjei zoldek voltak, a valodi uton meg
 * nem sult el semmi.
 *
 * === ES AMIERT A FORRAST OLVASSA ===
 *
 * A kepernyo Expo-modulokat importal, tehat egysegtesztben nem renderelheto
 * (ugyanez az indok all a `worksheet-close-wiring.spec.ts` folott). A forras
 * olvasasa kevesebbet bizonyit egy renderelesnel, de tobbet a semminel: azt
 * meri, hogy a BEKOTES ott all.
 *
 * === A HATARA, MERVE, ES NEM UTOLAG KITALALVA ===
 *
 * KALIBRALVA 2026-09-21, ket kulonbozo rontassal:
 *
 *   a bekotes ELTUNIK          (valaki "egyszerusit", es visszateszi a sima
 *   -> MEGFOGJA                 szoveget): mind a ket allitas pirosodik
 *
 *   a bekotes OTT MARAD, de    (`false && row.serviceJobId ?`): a minta
 *   HOLT AGGA valik             TOVABBRA IS illeszkedik, es a halo HALLGAT
 *   -> NEM FOGJA MEG
 *
 * Ez nem javithato egy jobb regularis kifejezessel: egy forrast olvaso halo a
 * JELENLETET tudja bizonyitani, az ELERHETOSEGET nem. Aki ezt tobbnek hiszi,
 * egy holt agra tett orzot fog vedelemnek nezni -- pontosan az a hiba, ami
 * ellen ez a fajl keszult.
 *
 * AMI TOBBET BIZONYITANA: egy renderelo teszt. Ahhoz a mobil csomagba
 * `@testing-library/react-native` kellene, ami ma nincs benne -- ezt a hatart
 * a lapom mar 2026-08-31 ota nevesiti, es a feltetele valtozatlan.
 */

/**
 * AZ UTVONAL A FORDITOTT FAJLTOL HAROM SZINTET LEP FEL -- ugyanaz az alak,
 * mint a szomszed `worksheet-close-wiring.spec.ts`-ben. Az elso valtozatom
 * `import.meta.url`-t hasznalt: az a TESZT-FORDITO modul-beallitasa alatt nem
 * megy (TS1343), es a hiba NULLA lefutott tesztet ad.
 */
const KEPERNYO = join(
  __dirname,
  "..",
  "..",
  "..",
  "src",
  "app",
  "worksheets",
  "[id].tsx",
);

function forras(): string {
  const s = readFileSync(KEPERNYO, "utf8");
  // ISMERT POZITIV KONTROLL: rossz utvonalnal ures szovegen minden allitas zold.
  assert.ok(s.length > 5000, "gyanúsan rövid képernyő-forrás");
  return s;
}

describe("a hibajegy-sor bekötése a munkalap-képernyőn", () => {
  const lap = forras();

  it("a sor CSAK akkor megnyomható, ha van hova vinnie", () => {
    /*
      A FELTETEL MAGA AZ ALLITAS: a `row.serviceJobId` nelkul sima szoveg all
      ott. Egy feltetel nelkuli Pressable a "Nincs mögötte hibajegy" sort is
      gombbá tenné -- es az sehova nem vinne.
    */
    assert.match(lap, /row\.serviceJobId \?/);
  });

  it("a hibajegy lapjára navigál, nem máshova", () => {
    const utan = lap.slice(lap.indexOf("row.serviceJobId ?"));
    assert.match(utan.slice(0, 400), /pathname: "\/service-jobs\/\[id\]"/);
    assert.match(utan.slice(0, 400), /params: \{ id: row\.serviceJobId/);
  });

  /**
   * ES A CELLAP LETEZIK. Enelkul a fenti ket allitas egy nem letezo utvonalra
   * mutato hivast is elfogadna -- a #480 indoka (`egy megnyomhatonak latszo
   * szam, ami sehova nem visz`) epp ez volt, es csak a #735 oldotta fel.
   */
  it("a hibajegy-képernyő tényleg létezik az appban", () => {
    const cel = join(
      __dirname,
      "..",
      "..",
      "..",
      "src",
      "app",
      "service-jobs",
      "[id].tsx",
    );
    assert.ok(readFileSync(cel, "utf8").length > 1000);
  });
});
