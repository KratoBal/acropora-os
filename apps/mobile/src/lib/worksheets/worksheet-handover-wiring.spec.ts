import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * AZ ATADAS BEKOTESE A MUNKALAP-KEPERNYON -- FORRAS SZINTEN.
 *
 * A dontesek a `worksheet-handover.ts`-ben allnak, es ott merhetok. Ami CSAK
 * itt dolhet el: hogy a kepernyo azokat HASZNALJA-e, es nem szamol-e ujra
 * sajat feltetellel. Egy masodik masolat epp ott csuszna el, ahol a legdragabb
 * (melyik iranyba megy a gomb).
 *
 * MIERT NEM RENDERELESSEL: ebben az appban nincs komponens-teszt eszkoz, es a
 * kepernyo `@/` alaku importokat hasznal, amiket a teszt-fordito nem old fel.
 * Ugyanaz az alak, mint a szomszed `worksheet-close-wiring.spec.ts`-ben.
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

/**
 * A KOMMENTEKET KISZEDJUK, ES EZ NEM OVATOSSAG.
 *
 * Merve 2026-09-08, egy nap alatt NEGYSZER: a sajat magyarazo szovegunk
 * tartalmazta azt, amit a meres keresett, es a hiany-allitas hamisan bukott
 * el -- vagy epp hamisan maradt zold. Ez a fajl KULONOSEN kiteve: a
 * kepernyo kommentjei SZO SZERINT idezik a fuggvenyneveket.
 */
function kodSzoveg(forras: string): string {
  return forras
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}

function forras(): string {
  const s = kodSzoveg(readFileSync(KEPERNYO, "utf8"));
  // ISMERT POZITIV KONTROLL: rossz utvonalnal ures szovegen minden allitas
  // zold lenne, a hiany-allitasok pedig epp attol.
  assert.ok(s.length > 5000, "gyanúsan rövid képernyő-forrás");
  return s;
}

describe("az átadás bekötése a munkalap-képernyőn", () => {
  const lap = forras();

  it("a kapu és az irány a modulból jön, nem a képernyőről", () => {
    assert.match(lap, /canMarkWorksheetHandover\(\{/);
    assert.match(lap, /handoverKuldendoErtek\(data\.handedOverAt\)/);
    assert.match(lap, /handoverGombFelirata\(/);
  });

  it("a hívás a szerverre megy", () => {
    assert.match(lap, /setWorksheetHandedOver\(id, handedOver\)/);
  });

  /**
   * A TERERO NELKULI AG SAJAT MONDATOT KAP, es ez nem szohasznalat: a
   * `lezarasHibaUzenete`-hez hasonloan a szerver mondata megy ki, DE a
   * halozati hiba eseten a szervernek nincs mondata. Ha ez az ag hianyozna,
   * a szerelo egy ures dobozt latna a pinceben.
   */
  it("hálózat nélkül a saját mondatát adja, nem a szerverét várja", () => {
    assert.match(lap, /ApiNetworkError\s*\n?\s*\?\s*ATADAS_TERERO_NELKUL/);
  });

  /**
   * A LAP ALLAPOTA NEM KAPU AZ ATADASON -- ES EZT ALLITANI KELL.
   *
   * A szomszed ket gomb (`canCloseWorksheetVersion`, `canSignWorksheetVersion`)
   * MINDKETTO `status`-t kap. A masolas kezenfekvo, es egy hozzaadott
   * `status: current.status` sor CSENDBEN elvenne az atadast az alairt
   * lapokrol -- epp azoktol, ahol a muhelybol visszaszallitas kesobb tortenik.
   */
  it("az átadás kapuja NEM kap állapotot", () => {
    const hivas = lap.match(/canMarkWorksheetHandover\(\{[\s\S]{0,200}?\}\)/);

    // ISMERT POZITIV KONTROLL: a minta egyaltalan talalt hivast. Enelkul a
    // lenti tagadas egy nem letezo hivasra is zold lenne.
    assert.ok(hivas, "nem találtam canMarkWorksheetHandover hívást");
    assert.ok(!hivas[0].includes("status"));

    // ES A SZOMSZED HIVAS IGENIS KAP ALLAPOTOT: ez bizonyitja, hogy a fenti
    // minta MEG TUDNA talalni egy `status` sort, ha ott allna.
    const lezaras = lap.match(/canCloseWorksheetVersion\(\{[\s\S]{0,200}?\}\)/);
    assert.ok(lezaras?.[0].includes("status"));
  });
});
