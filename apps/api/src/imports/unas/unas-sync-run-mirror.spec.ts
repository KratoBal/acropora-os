import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * AMIT A VÁLASZ TÍPUSA ÍGÉR, AZT A LEKÉRDEZÉS ADJA IS MEG.
 *
 * === A MÉRT RÉS (2026-09-17, kalibrációból) ===
 *
 * A futás-sor négy új számlálóját hozzáadtam a sémához, a két `select`-hez és a
 * közös típushoz. A kalibrációnál kivettem a mezőket MIND A KÉT `select`-ből --
 * és a `typecheck` ZÖLD MARADT.
 *
 * Az ok: a vezérlő a tároló válaszát adja vissza, annotáció nélkül; a web pedig
 * a saját oldalán DEKLARÁLJA a `UnasProductSyncRun` típust. A két oldal így
 * SOHA nem találkozik a fordítóban. A hiba néma lett volna: a mező `undefined`,
 * és a táblában `NaN` jelenik meg, mert az oszlop két szám összege.
 *
 * === MIÉRT NEM A VISSZATÉRÉSI TÍPUS KIÍRÁSA A JAVÍTÁS (MA) ===
 *
 * Az lenne az erősebb alak, és a hibajegy-modul már így áll. Itt egy különbség
 * útban van: a tároló `Date` értékeket ad, a közös típus `string`-et deklarál
 * (a JSON-ba a Nest szerializálja). A kettő összekötése MAPPELÉST kíván, ami
 * ennek a kártyának a tárgyán kívül esik -- külön tételként megnevezve áll.
 *
 * Addig ez a fájl a padló: a MEZŐNEVEKET veti össze, nem a típusokat. Egy
 * `string` kontra `number` eltérés átcsúszik rajta -- de a mai rést, ami NÉV
 * volt, megfogja.
 */
const TAROLO = "src/imports/unas/unas-product-sync.repository.ts";
const KOZOS = "../../packages/types/src/integrations/unas-product-sync.ts";

function forras(ut: string): string {
  const s = readFileSync(ut, "utf8");
  // POZITIV KONTROLL A BEOLVASASRA: rossz utvonalnal ket URES halmazt vetnenk
  // ossze -- zolden.
  assert.ok(s.length > 1000, `${ut}: üres vagy gyanúsan rövid`);
  return s;
}

/** Egy `interface` mezonevei, ahogy a fajlban allnak. */
function tipusMezok(s: string, nev: string): Set<string> {
  const start = s.indexOf(`export interface ${nev} `);
  assert.notEqual(start, -1, `nem találtam: ${nev}`);
  const veg = s.indexOf("\n}", start);
  assert.notEqual(veg, -1, `nem találtam a végét: ${nev}`);
  return new Set(
    [...s.slice(start, veg).matchAll(/^ {2}([A-Za-z_]\w*)\??\s*:/gm)].map(
      (m) => m[1]!,
    ),
  );
}

/**
 * EGY `select: { ... }` BLOKK KULCSAI, A METODUS NEVE UTAN.
 *
 * A metodus NEVEHEZ kotve keresunk, nem az elso `select`-hez a fajlban: ebben a
 * taroloban tobb tucat lekerdezes all, es egy nev nelkuli kereses barmelyiket
 * megtalalhatna -- a zold pedig ugyanugy nezne ki.
 */
function selectMezok(s: string, metodus: string): Set<string> {
  const start = s.indexOf(metodus);
  assert.notEqual(start, -1, `nem találtam a metódust: ${metodus}`);
  const selectStart = s.indexOf("select: {", start);
  assert.notEqual(selectStart, -1, `nincs select a(z) ${metodus} után`);
  const veg = s.indexOf("\n      },", selectStart);
  assert.notEqual(veg, -1, `nem találtam a select végét: ${metodus}`);
  return new Set(
    [
      ...s.slice(selectStart, veg).matchAll(/^\s{8}([A-Za-z_]\w*): true,/gm),
    ].map((m) => m[1]!),
  );
}

describe("a futás-sor válasza megadja, amit a típusa ígér", () => {
  it("POZITÍV KONTROLL: a kiolvasás nem üres halmazokat ad", () => {
    assert.ok(tipusMezok(forras(KOZOS), "UnasProductSyncRun").size >= 10);
    assert.ok(selectMezok(forras(TAROLO), "async getRun(").size >= 10);
  });

  /**
   * A NEV ES A MINTA KULON: a minta a KERESESHEZ kell (nyito zarojellel, hogy
   * egy hasonlo nevu metodusra ne illeszkedjen), a nev a TESZT CIMEHEZ -- azt
   * a CI naplojabol olvassuk vissza, es ott egy csonka zarojel csak zavar.
   */
  for (const { nev, minta } of [
    { nev: "getRun", minta: "async getRun(" },
    { nev: "listRuns", minta: "listRuns(" },
  ]) {
    it(`a ${nev} minden ígért mezőt kiválaszt`, () => {
      const igert = tipusMezok(forras(KOZOS), "UnasProductSyncRun");
      const kivalasztott = selectMezok(forras(TAROLO), minta);
      const hianyzik = [...igert].filter((mezo) => !kivalasztott.has(mezo));
      assert.deepEqual(
        hianyzik,
        [],
        `a válasz típusa ígéri, de a lekérdezés nem adja: ${hianyzik.join(", ")} -- ` +
          "a mező `undefined` lenne a felületen, hibaüzenet nélkül",
      );
    });
  }
});
