import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * A HIBAJEGY CSATOLMÁNY-SZAKASZÁNAK BEKÖTÉSE.
 *
 * Ugyanaz a szerkezet, mint a `worksheet-gallery-wiring.spec.ts`-é, és
 * SZÁNDÉKOSAN nem egy közös, paraméterezett készlet: a két képernyő más
 * jogosultsági nevet használ (`worksheetsManage` kontra `serviceJobsManage`) és
 * más útvonal-előtagot, és épp azok a különbségek azok, amiket mérni kell. Egy
 * paraméterezett változat a nevet ADATTÁ tenné, és nem venné észre, ha egy
 * képernyő a MÁSIK képernyő kulcsát kapná meg.
 *
 * Ebben a csomagban nincs komponens-teszt, ezért ezek az állítások a képernyő
 * FORRÁSÁT olvassák. A HATÁRA kimondva: azt mérik, hogy a képernyő a helyes
 * hívásokat írja le, nem azt, hogy a szerelő LÁTJA a képet.
 */
const KEPERNYO = "src/app/service-jobs/[id].tsx";
const KLIENS = "src/lib/api/service-jobs.ts";

const olvas = (ut: string) => readFileSync(ut, "utf8");

describe("a hibajegy csatolmány-szakasza", () => {
  it("POZITÍV KONTROLL: a két fájl olvasható és nem üres", () => {
    for (const ut of [KEPERNYO, KLIENS])
      assert.ok(olvas(ut).length > 2000, `${ut}: üres vagy gyanúsan rövid`);
  });

  it("a képernyő lekéri a csatolmányok listáját", () => {
    // A HÍVÁS ALAKJÁRA, nem a névre: a név az `import` sorban is ott áll.
    assert.match(olvas(KEPERNYO), /queryFn: \(\) => listServiceJobDocuments\(/);
    assert.match(
      olvas(KLIENS),
      /export function listServiceJobDocuments\(id: string\)/,
    );
  });

  /**
   * A SZAKASZ A `manage` KAPUN KÍVÜL ÁLL -- ÉS EZ A LÉNYEGI DÖNTÉS.
   *
   * A megnézés `service.view` alatt áll, a feltöltés `service.manage` alatt. Ha
   * a galéria a feltöltő szakasz kapuján BELÜL állna, a szerelő-néző épp azt
   * nem látná, amiért a képek felkerültek.
   */
  it("a csatolmány-szakasz nem a szerkesztési jogra van kapuzva", () => {
    const s = olvas(KEPERNYO);
    const szakasz = s.indexOf("Csatolmányok (");
    const kapu = s.indexOf("{capabilities?.serviceJobsManage ? (");
    assert.ok(szakasz !== -1, "nem találom a csatolmány-szakaszt");
    assert.ok(kapu !== -1, "nem találom a szerkesztési kaput");
    assert.ok(
      szakasz < kapu,
      "a csatolmány-szakasz a szerkesztési kapu mögé került: aki csak nézhet, nem látná a képeket",
    );
  });

  /**
   * AZ ÚTVONAL A KLIENS SAJÁT `BASE`-ÉVEL EGYEZIK, NEM A MAPPA NEVÉVEL.
   *
   * EZ AZ ÁLLÍTÁS EGY MÉRT HIBÁBÓL SZÜLETETT: az első alakom
   * `/service/service-jobs/...` volt, a képernyő mappája után -- a kliens `BASE`
   * viszont `/service/jobs`. A hiba NÉMA lett volna: a lista betöltődik, a
   * csempék megjelennek, és minden kép "nem tölthető be" felirattal áll.
   */
  it("a kép-forrás a kliens BASE útvonalával egyezik", () => {
    const base = olvas(KLIENS).match(/^const BASE = "([^"]+)";/m);
    assert.ok(base, "nem találom a kliens BASE értékét");
    assert.match(
      olvas(KEPERNYO),
      new RegExp(
        `useDocumentImageSource\\(\\s*(/\\*[\\s\\S]*?\\*/\\s*)?id \\? \`${base[1]}/`,
      ),
      `a kép-forrás útvonala nem a kliens BASE-ét (${base[1]}) használja`,
    );
  });

  it("a kép a hitelesített forrásból jön, nem csupasz címről", () => {
    const s = olvas(KEPERNYO);
    assert.match(s, /useDocumentImageSource\(/);
    assert.match(s, /source=\{forras\}/);
  });

  /**
   * A FELTÖLTÉS A LISTÁT IS ÉRVÉNYTELENÍTI.
   *
   * Enélkül a frissen feltöltött kép NEM jelenne meg, és a szerelő pontosan azt
   * látná, amit a szakasz előtti hiánynál: feltöltött, és nincs sehol. Ezt a
   * bekötést az első változatomból KIHAGYTAM, és a munkalap mintája hozta elő.
   */
  it("a feltöltés a csatolmány-listát is érvényteleníti", () => {
    const s = olvas(KEPERNYO);
    const db = s.split('queryKey: ["service-job-documents", id]').length - 1;
    assert.ok(
      db >= 2,
      `a lista-kulcs ${db} helyen áll; a lekérdezés mellett az érvénytelenítésnél is kell`,
    );
  });

  it("a nagy kép rátét, nem Modal", () => {
    const s = olvas(KEPERNYO);
    assert.doesNotMatch(s, /<Modal/);
    assert.match(s, /styles\.nagyRatet/);
  });

  it("a nem megnézhető csatolmány neve kiíródik", () => {
    assert.match(olvas(KEPERNYO), /describeUnviewableDocument\(doc\)/);
  });
});
