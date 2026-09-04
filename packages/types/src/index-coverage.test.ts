import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * A GYOKER UJRAEXPORTALJA-E, AMIT A MODULOK DEFINIALNAK.
 *
 * A CSOMAG GYOKERE NEVVEL EXPORTAL, NEM `export *` ALAKBAN (merve: nulla
 * csillagos ujraexport all benne). Ezert minden uj tipust KEZZEL kell felvenni --
 * es aki elfelejti, NEM KAP JELZEST. A tipus letezik, a sajat modulja
 * hasznalja, a fordito hallgat, mert a modul-fajlt kozvetlenul importalo kod
 * megtalalja. A hiany csak akkor jelenik meg, amikor egy MASIK csomag
 * `@acropora/types` alol keresi -- akar hetekkel kesobb.
 *
 * A MERT ESET, AMIERT EZ A FAJL LETEZIK (2026-09-04): az 522-es PR felvette a
 * `UnasSimilarProduct` tipust, de a gyokerbol nem exportalta ujra. A testvere
 * (`UnasPackageComponent`) ott allt. Semmi nem hibazott, amig az 540 hasznalni
 * nem akarta -- akkor forditasi hibaval derult ki.
 *
 * ES A MASODIK, AMIT EZ A HALO ELSO FUTASA TALALT: az `AssetUnitSummary`
 * ugyanigy kimaradt. A mobil oldalan egy KOMMENT hivatkozik ra
 * (`apps/mobile/src/lib/partners/site-tree.ts`), vagyis valaki meg akarta nevezni
 * a tipust, es nem tudta importalni. Kozben ki is szivargott, mert egy masik,
 * exportalt tipus MEZOJEKENT ott all -- a fogyaszto tehat HASZNALTA azt, amit
 * megnevezni nem tudott.
 */

/** A forrasfa: a forditott teszt a `test-dist/` alatt fut, a forras mellette. */
const SRC = new URL("../src/", import.meta.url).pathname;

/**
 * EZ A FAJL KIMARAD A BEJARASBOL, ES A KIZARAS SZERKEZETI, NEM NEV SZERINTI.
 *
 * Egy halo, ami a sajat forrasat is bejarja, a sajat peldait leletnek veszi. A
 * testverhalonal (`env-template-coverage`) ez meg is tortent: az elso futasa
 * negy nem letezo valtozot jelentett, mert a sajat kontroll-mintajat olvasta be.
 *
 * A nev szerinti kizaras (peldaul egy `PELDA_` elotag) rossz megoldas lenne:
 * az kezzel karbantartott kivetel, es a kovetkezo pelda mas nevet kapna.
 */
const SAJAT_FAJL = "index-coverage.test.ts";
const GYOKER_FAJL = "index.ts";

/**
 * SZANDEKOSAN NEM EXPORTALT NEVEK. MA URES, ES EZ NEM VELETLEN.
 *
 * Merve a felvetelekor: 376 exportalt nevbol 375 allt a gyokerben, es az
 * egyetlen hianyzo VALODI hiany volt, nem szandek. Vagyis a halo ma
 * KIELEGITHETO -- nem az a fajta orzo, ami a rendes munkat allitja meg.
 *
 * HA IDE VALAHA NEV KERUL, az azt jelenti, hogy egy tipus SZANDEKOSAN csak a
 * csomagon belul letezik. Akkor a sor melle oda kell irni, MIERT -- kulonben a
 * kovetkezo olvaso nem tudja megkulonboztetni a dontest a feledekenysegtol.
 */
const SZANDEKOSAN_BELSO: ReadonlySet<string> = new Set([]);

/** Minden `.ts` a fan, a sajat fajl, a gyoker es a tesztek nelkul. */
function modulFajlok(konyvtar = SRC): string[] {
  const ki: string[] = [];
  for (const bejegyzes of readdirSync(konyvtar, { withFileTypes: true })) {
    const ut = join(konyvtar, bejegyzes.name);
    if (bejegyzes.isDirectory()) {
      ki.push(...modulFajlok(ut));
      continue;
    }
    if (!bejegyzes.name.endsWith(".ts")) continue;
    if (bejegyzes.name.endsWith(".test.ts")) continue;
    if (bejegyzes.name === SAJAT_FAJL || bejegyzes.name === GYOKER_FAJL)
      continue;
    ki.push(ut);
  }
  return ki;
}

/**
 * A HAROM EXPORT-ALAK, ES MINDHAROMRA KULON MINTA KELL.
 *
 * Ha csak az elsore keresnenk (`export interface X`), a masik ket alakban
 * definialt tipusok CSENDBEN kimaradnanak a merceből -- vagyis a halo epp azokat
 * nem nezne, amiket a legkonnyebb elfelejteni.
 */
const KOZVETLEN =
  /^export\s+(?:declare\s+)?(?:abstract\s+)?(?:type|interface|const|let|var|function|enum|class)\s+(\w+)/gm;
const CSOPORTOS = /^export\s+(?:type\s+)?\{([^}]*)\}\s*;/gm;
const UJRAEXPORT =
  /^export\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["'][^"']+["']/gm;

/** A `//` es a `/* *\/` kommentek nelkul: egy peldakent idezett export nem lelet. */
function kodSorok(szoveg: string): string {
  return szoveg.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function nevekCsoportbol(csoport: string): string[] {
  return csoport
    .split(",")
    .map((resz) => resz.trim())
    .filter(Boolean)
    .map((resz) =>
      resz
        .split(/\s+as\s+/)
        .pop()!
        .trim(),
    );
}

function modulExportok(ut: string): Set<string> {
  const szoveg = kodSorok(readFileSync(ut, "utf8"));
  const nevek = new Set<string>();
  for (const talalat of szoveg.matchAll(KOZVETLEN)) nevek.add(talalat[1]!);
  for (const talalat of szoveg.matchAll(CSOPORTOS))
    for (const nev of nevekCsoportbol(talalat[1]!)) nevek.add(nev);
  return nevek;
}

function gyokerUjraexportok(): Set<string> {
  const szoveg = kodSorok(readFileSync(join(SRC, GYOKER_FAJL), "utf8"));
  const nevek = new Set<string>();
  for (const talalat of szoveg.matchAll(UJRAEXPORT))
    // az ujraexportnal a FORRAS-oldali nev szamit: `export { A as B }` az A-t hozza
    for (const resz of talalat[1]!.split(",")) {
      const tiszta = resz.trim();
      if (tiszta) nevek.add(tiszta.split(/\s+as\s+/)[0]!.trim());
    }
  return nevek;
}

describe("a csomag gyökerének export-lefedettsége", () => {
  it("a gyökér nem használ csillagos újraexportot", () => {
    /**
     * EZ AZ ALLITAS A TOBBI ELOFELTETELE, ES EZERT ALL ELOL.
     *
     * Egyetlen `export * from "./modul.js"` sor eleg ahhoz, hogy az abbol a
     * modulbol szarmazo nevek a gyokerbol elerhetok legyenek anelkul, hogy
     * felsorolnank oket -- es akkor a lenti allitas hamis hianyt jelentene.
     */
    const szoveg = kodSorok(readFileSync(join(SRC, GYOKER_FAJL), "utf8"));
    assert.deepEqual(szoveg.match(/^export\s+\*/gm) ?? [], []);
  });

  it("minden modul-export elérhető a gyökérből", () => {
    const ujraexportalt = gyokerUjraexportok();
    const hianyzo: string[] = [];
    for (const ut of modulFajlok())
      for (const nev of modulExportok(ut))
        if (!ujraexportalt.has(nev) && !SZANDEKOSAN_BELSO.has(nev))
          hianyzo.push(`${ut.slice(SRC.length)}: ${nev}`);

    assert.deepEqual(
      hianyzo.sort(),
      [],
      `Ezek a nevek nem érhetők el a csomag gyökeréből. Vedd fel őket az ` +
        `index.ts megfelelő blokkjába, vagy ha SZÁNDÉKOSAN belsők, a ` +
        `SZANDEKOSAN_BELSO halmazba az indoklással együtt:\n` +
        hianyzo.join("\n"),
    );
  });

  it("a bejárás lát modulokat és neveket", () => {
    /**
     * ISMERT POZITIV KONTROLL, ES NEM FORMASAG.
     *
     * A fenti allitas AKKOR IS zold, ha a bejarasom nulla fajlt talal (rossz
     * utvonal, elirt kiterjesztes, megvaltozott konyvtar-szerkezet). Egy ures
     * halmazbol semmi nem hianyzik. Ez a sor valasztja szet a "minden rendben"
     * es a "nem neztem meg semmit" allapotot.
     */
    const fajlok = modulFajlok();
    assert.ok(fajlok.length > 20, `csak ${fajlok.length} modul-fajlt talaltam`);
    const nevek = fajlok.reduce((n, ut) => n + modulExportok(ut).size, 0);
    assert.ok(nevek > 200, `csak ${nevek} exportalt nevet talaltam`);
    assert.ok(
      gyokerUjraexportok().size > 200,
      `csak ${gyokerUjraexportok().size} ujraexportot talaltam`,
    );
  });
});
