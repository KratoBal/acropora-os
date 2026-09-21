import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * A HELYSZIN-LETOLTO BEKOTESE -- FORRAS SZINTEN.
 *
 * MIERT NEM RENDERELESSEL: az `apps/mobile` alatt nincs komponens-teszt eszkoz.
 * Amit itt merunk, az a HIVAS ALAKJA; a MENET maga (lapozas, hibakezeles,
 * reszleges letoltes) valodi allitasokkal all a
 * `helyszin-letoltes-futtato.spec.ts`-ben.
 */
const KEPERNYO = join(
  __dirname,
  "..",
  "..",
  "..",
  "src",
  "components",
  "offline",
  "HelyszinLetolto.tsx",
);
const FOKEPERNYO = join(__dirname, "..", "..", "..", "src", "app", "index.tsx");

const olvas = (ut: string) => readFileSync(ut, "utf8");
const kod = (ut: string) =>
  olvas(ut)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("a helyszín-letöltő bekötése", () => {
  it("POZITÍV KONTROLL: a komponens olvasható és nem üres", () => {
    assert.ok(olvas(KEPERNYO).length > 2000);
  });

  /**
   * A KET LISTA A HELYSZINRE SZURVE, A SZERVEREN.
   *
   * MI PIROSIT: egy `departmentId` nelkuli hivas. Az eszkozoknel a partner
   * OSSZES eszkoze jonne le (idegen helyszinek adata a keszuleken), a
   * munkalapoknal ugyanez -- es a keszuleken levo masolat CSENDBEN tagabb
   * lenne, mint a felirata.
   */
  it("az eszköz- és a munkalap-lista a helyszínre szűrve kérdez", () => {
    const s = kod(KEPERNYO);
    assert.match(s, /listAssets\(oldal, 50, "", departmentId\)/);
    assert.match(
      s,
      /listWorksheets\(\{\s*page: oldal,\s*pageSize: 100,\s*departmentId,?\s*\}\)/,
    );
  });

  /**
   * A TELJES ADATLAP AZ, AMIERT EZ A GOMB LETEZIK. Balazs szava: a kollega ma
   * "minden eszkoz adatlapjat meg kell nyitnia", mielott lemegy. A lista-sor
   * ehhez keves.
   *
   * MI PIROSIT: ha csak a listak mentodnek, reszletlap nelkul.
   */
  it("a részletlapok is lejönnek, nem csak a listasorok", () => {
    const s = kod(KEPERNYO);
    assert.match(s, /eszkozReszlet: getAsset/);
    assert.match(s, /eszkozReszletMentese: rememberAssetDetail/);
    assert.match(s, /jegyReszlet: getServiceJob/);
    assert.match(s, /munkalapReszlet: getWorksheet/);
  });

  /**
   * GOMB, NEM VALTOKAPCSOLO -- es ez a kartya elso kikotese.
   *
   * Egy kezi Online/Offline kapcsolo BERAGAD: aki este elfelejti
   * visszabillenteni, annal napokig nem megy fel semmi, es errol nem tud.
   *
   * MI PIROSIT: egy `Switch` a komponensben, vagy a halozat-figyeles
   * atirasa. A masodik allitas ezert nezi a `connectivity` modult is.
   */
  it("gomb, nem váltókapcsoló, és a hálózat-figyelést nem bántja", () => {
    const s = kod(KEPERNYO);
    assert.ok(!/<Switch|from "@\/lib\/offline\/connectivity/.test(s));
    assert.match(s, /accessibilityRole="button"/);
  });

  /**
   * A VISSZAJELZES A FELADAT RESZE, ES A HIANYOS LETOLTES MAS SZINT KAP.
   *
   * MI PIROSIT: ha a ket ag ugyanazt a stilust hasznalja. Egy azonos kinezetu
   * doboz mellett a kulonbseget csak a SZOVEGBOL lehetne kiolvasni -- azt
   * pedig a pinceben siet az ember atsiklani.
   */
  it("a hiányos letöltés más dobozt kap, mint a kész", () => {
    const s = kod(KEPERNYO);
    assert.match(s, /osszegzes\.teljes \? styles\.kesz : styles\.hianyos/);
    assert.match(s, /\{osszegzes\.cim\}/);
  });

  /**
   * ES A FOKEPERNYON TENYLEG OTT VAN, szervizes szemnek. Enelkul a fenti
   * allitasok egy olyan komponenst is zolden hagynanak, amit senki nem lat.
   */
  it("POZITÍV KONTROLL: a főképernyő kirajzolja, szervizes jogosultsággal", () => {
    assert.match(
      kod(FOKEPERNYO),
      /serviceCapabilities\.assetsView \? <HelyszinLetolto \/> : null/,
    );
  });
});
