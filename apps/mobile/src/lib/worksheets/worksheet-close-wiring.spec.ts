import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * A LEZARAS BEKOTESE A KEPERNYON -- FORRAS SZINTEN.
 *
 * A dontesek a `worksheet-close.ts`-ben allnak, es ott merhetok. Ami CSAK itt
 * dolhet el: hogy a kepernyo azokat hasznalja-e, es hogy a ket gomb a helyes
 * SORRENDBEN all-e.
 *
 * MIERT NEM RENDERELESSEL: ebben az appban nincs komponens-teszt eszkoz, es a
 * kepernyo `@/` alaku importokat hasznal, amiket a teszt-fordito nem old fel.
 */
/**
 * AZ UTVONAL A FORDITOTT FAJLTOL HAROM SZINTET LEP FEL, es ez nem stilus: a
 * teszt a `test-dist` alol fut, tehat a `__dirname` OTT all, es a `.tsx` forras
 * a `src` alatt. Az elso alakom ket szintet lepett, es a `forras()` DOBOTT a
 * describe torzseben -- olyankor a node:test `# fail` szamlaloja NULLA marad,
 * es csak a `not ok <n>` sor arulja el. A szomszed kepernyo-spec
 * (`worksheet-under-ticket-screen.spec.ts`) ugyanezt az alakot hasznalja.
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

describe("a lezárás bekötése a munkalap-képernyőn", () => {
  const lap = forras();

  it("a lezáró hívás a szerverre megy, és a döntés a modulból jön", () => {
    assert.match(lap, /closeWorksheet\(id\)/);
    assert.match(lap, /canCloseWorksheetVersion\(\{/);
  });

  /**
   * A SORREND ALLITAS, NEM IZLES: a lezaras az alairas ELOFELTETELE, es a ket
   * gomb egymas alatt mutatja meg a szerelonek, hova tart. Forditva az alairas
   * gombja allna elol egy olyan lapon, amin meg sosem jelenhet meg.
   */
  it("a lezáró gomb az aláírás gombja ELŐTT áll", () => {
    const lezaro = lap.indexOf("canCloseWorksheetVersion({");
    const alairo = lap.indexOf("canSignWorksheetVersion({");
    assert.notEqual(lezaro, -1);
    assert.notEqual(alairo, -1);
    assert.ok(
      lezaro < alairo,
      "a lezáró gomb az aláírás gombja UTÁN áll a forrásban",
    );
  });

  /**
   * A LEZARAS UTAN A KEPERNYO FRISSUL -- enelkul a lap piszkozatkent maradna a
   * kepen, es az alairas gombja nem jelenne meg. Balazs egy mozdulatban varja a
   * kettot, tehat ez a sor az, amitol az egesz kartya ertelmet nyeri.
   */
  it("lezárás után frissíti a lapot", () => {
    const utan = lap.slice(lap.indexOf("closeWorksheet(id)"));
    assert.match(
      utan.slice(0, 600),
      /invalidateQueries\(\{ queryKey: \["worksheet", id\] \}\)/,
    );
  });

  /**
   * ES A TERERO NELKULI AG SAJAT MONDATOT KAP, nem a szerverét: ott nincs is
   * szerver-valasz. A megtagadas HANGOS; egy sorba tett lezaras csendes lenne.
   */
  it("hálózati hibánál a saját mondatát adja, nem a szerverét", () => {
    assert.match(lap, /ApiNetworkError\s*\n?\s*\?\s*LEZARAS_TERERO_NELKUL/);
    assert.match(lap, /lezarasHibaUzenete\(/);
  });
});
