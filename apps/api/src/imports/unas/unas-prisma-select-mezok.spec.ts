import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * AMIT EGY PARANCS A `select` BLOKKBAN KER, AZ LETEZZEN A SEMAN.
 *
 * === A MERT HIBA (2026-09-17) ===
 *
 * A kapcsolat-ujraepites parancsa tizenkilenc zold allitassal ment be, es EGY
 * VALODI ADATBAZISON SEM TUDOTT ELINDULNI:
 *
 *     Unknown field `externalId` for select statement on model
 *     `UnasProductSnapshot`
 *
 * A modellen `productId` all; a kulso azonosito az `ExternalReference` tablan
 * lakik. Ugyanez a fajta hiba allitotta meg az ar-tortenet parancsat is
 * (`syncedAt`, 2026-09-15), es akkor is csak az eles futaskor derult ki.
 *
 * === MIERT NEM FOGJA MEG A TYPECHECK ===
 *
 * A Prisma `select` tipusai az ISMERETLEN kulcsot nem utasitjak el (lasd a sajat
 * feljegyzesemet). A fordito tehat zold marad, es a hiba a FUTASKOR jon elo --
 * egy olyan parancsnal, ami definicio szerint ritkan fut.
 *
 * === MIT MER EZ, ES MIT NEM ===
 *
 * A parancs forrasabol kiolvassa a `select` blokkok kulcsait, modellenkent
 * (BEAGYAZOTT selectekkel egyutt), es osszeveti a sema mezoneveivel. NEM meri a
 * tipusokat es a `where` agakat -- PADLO, nem garancia.
 *
 * === ES EGY HATAR, AMIT A KALIBRACIO MUTATOTT MEG ===
 *
 * Ahol a hivo KIIRJA a varrat alakjat (az ar-parancs `KezdoSorJelolt`
 * interfesze), ott a FORDITO mar ma is megfogja a rossz mezonevet: a
 * beagyazott `syncedAt` visszatetele ott forditasi hibat ad, nem ezt a pirosat.
 *
 * Ez a fajl tehat ott ER valamit, ahol a varratnak NINCS kiirt alakja -- es epp
 * az volt a kapcsolat-parancs esete: a `sor.externalId` atment a forditon, mert
 * a Prisma `select` tipusai az ismeretlen kulcsot nem utasitjak el, es az
 * eredmeny tipusaba is beleveszik.
 *
 * A KETTO EGYUTT FED: a kiirt alak a hivo oldalan, ez a spec a lekerdezesen.
 */
const SEMA = "../../packages/database/prisma/schema.prisma";

/** A vizsgalt parancsok, es a bennuk hivott modellek. */
const FAJLOK = [
  "src/imports/unas/unas-kapcsolat-ujraepites.cli.ts",
  "src/imports/unas/unas-kezdo-ar-sorok.cli.ts",
];

function forras(ut: string): string {
  const s = readFileSync(ut, "utf8");
  assert.ok(s.length > 500, `${ut}: üres vagy gyanúsan rövid`);
  return s;
}

/** Egy `model X { ... }` blokk sorai a semabol: mezonev -> tipus. */
function semaMezokTipussal(sema: string, modell: string): Map<string, string> {
  const start = sema.indexOf(`model ${modell} {`);
  assert.notEqual(start, -1, `nincs ilyen modell a sémában: ${modell}`);
  const veg = sema.indexOf("\n}", start);
  assert.notEqual(veg, -1, `nem találom a modell végét: ${modell}`);
  return new Map(
    [...sema.slice(start, veg).matchAll(/^\s{2}(\w+)\s+(\w+)/gm)].map((m) => [
      m[1]!,
      m[2]!,
    ]),
  );
}

function semaMezok(sema: string, modell: string): Set<string> {
  return new Set(semaMezokTipussal(sema, modell).keys());
}

/**
 * EGY `select: { ... }` BLOKK, BEAGYAZOTT SELECTEKKEL EGYUTT.
 *
 * A BEAGYAZAS NEM ELHAGYHATO, ES EZT EGY HAMIS PIROS TANITOTTA MEG. Az elso
 * alakom a beagyazott kulcsokat a KULSO modellhez szamolta, es az ar-parancsra
 * azonnal pirosat adott: a `netPrice` es tarsai a `Product` modellen tenyleg
 * nincsenek -- de nem is ott kertuk oket, hanem a `unasSnapshot` relacio alatt.
 *
 * ES A LAPOS VALTOZAT NEM CSAK HAMIS PIROST ADNA: epp azt az esetet HAGYNA KI,
 * amire a legjobban kell. Az ar-parancs valodi hibaja (`syncedAt`, 2026-09-15)
 * BEAGYAZOTT blokkban allt.
 */
interface SelectAg {
  modell: string;
  mezok: string[];
}

function selectAgak(
  kod: string,
  kezdet: number,
  modell: string,
  sema: string,
  gyujto: SelectAg[],
): number {
  const mezok: string[] = [];
  let i = kod.indexOf("{", kezdet) + 1;
  for (;;) {
    const kovetkezoVeg = kod.indexOf("}", i);
    const kulcs = /(\w+):\s*(true|\{)/g;
    kulcs.lastIndex = i;
    const m = kulcs.exec(kod);
    if (!m || m.index > kovetkezoVeg) {
      gyujto.push({ modell, mezok });
      return kovetkezoVeg + 1;
    }
    if (m[2] === "true") {
      mezok.push(m[1]!);
      i = m.index + m[0]!.length;
      continue;
    }
    // BEAGYAZOTT SELECT: a relacio TIPUSA a semabol jon, nem a nev alakjabol.
    mezok.push(m[1]!);
    const relacio = semaMezokTipussal(sema, modell).get(m[1]!);
    assert.ok(relacio, `${modell}.${m[1]} nincs a sémában`);
    const belso = kod.indexOf("select:", m.index);
    i = selectAgak(kod, belso, relacio, sema, gyujto);
  }
}

/** A `prisma.<modell>.<muvelet>({ ... })` hivasok select-agai, modellenkent. */
function selectMezok(kod: string, sema: string): Map<string, Set<string>> {
  const talalt = new Map<string, Set<string>>();
  for (const m of kod.matchAll(/prisma\.(\w+)\.\w+\(\{/g)) {
    const utana = kod.slice(m.index!, m.index! + 2000);
    const selectStart = utana.indexOf("select:");
    if (selectStart === -1) continue;
    const modell = m[1]![0]!.toUpperCase() + m[1]!.slice(1);
    const agak: SelectAg[] = [];
    selectAgak(kod, m.index! + selectStart, modell, sema, agak);
    for (const ag of agak)
      talalt.set(
        ag.modell,
        new Set([...(talalt.get(ag.modell) ?? []), ...ag.mezok]),
      );
  }
  return talalt;
}

describe("a parancsok select-mezői léteznek a sémán", () => {
  const sema = forras(SEMA);

  it("POZITÍV KONTROLL: a kiolvasás talál modellt és mezőt", () => {
    // Ket ISMERT mezo, ket kulonbozo modellrol: ha a sema-olvaso romlik el, ez
    // bukik eloszor, es nem a lenti allitasok adnak hamis zoldet egy ures
    // halmazon.
    assert.ok(semaMezok(sema, "UnasProductSnapshot").has("productId"));
    assert.ok(semaMezok(sema, "ExternalReference").has("entityId"));

    const mezok = selectMezok(forras(FAJLOK[0]!), sema);
    assert.ok(
      mezok.size >= 2,
      `gyanúsan kevés select-blokkot találtam: ${[...mezok.keys()].join(", ")}`,
    );
  });

  for (const fajl of FAJLOK) {
    it(`${fajl.split("/").pop()} minden select-mezője létezik`, () => {
      const mezok = selectMezok(forras(fajl), sema);
      assert.ok(mezok.size > 0, `nem találtam select blokkot: ${fajl}`);
      for (const [modell, kertek] of mezok) {
        const semaban = semaMezok(sema, modell);
        const hianyzik = [...kertek].filter((mezo) => !semaban.has(mezo));
        assert.deepEqual(
          hianyzik,
          [],
          `${fajl}: a(z) ${modell} modellen nincs ilyen mező: ${hianyzik.join(", ")} -- ` +
            "a parancs el sem indulna (Unknown field ... for select statement)",
        );
      }
    });
  }
});
