import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * A VERZIÓ-MÁSOLÁS NEM HAGYHAT KI MEZŐT -- ÉS EZT MA SEMMI NEM ŐRIZTE.
 *
 * === A MÉRT KOCKÁZAT (2026-09-17) ===
 *
 * Minden sor-írás EGY helyen megy át: `lineData()` a worksheets.repository.ts
 * fájlban, és az KÉZZEL SOROLJA FEL a mezőket. Egy munkalap MÓDOSÍTÁSA új
 * verziót készít, és a sorokat ezen a függvényen át másolja.
 *
 * Ha egy ÚJ oszlop kimarad ebből a felsorolásból, akkor a módosítás pillanatában
 * az értéke elvész, és a séma alapértelmezésére esik vissza. Semmi nem szól:
 *
 *   - a fordító nem, mert a `createMany` adata részleges objektumot is elfogad,
 *     amíg minden kötelező mezőnek van alapértelmezése;
 *   - a tesztek nem, mert azok az ÍRT mezőkről állítanak, nem a kimaradtakról;
 *   - a felhasználó nem, mert az érték nem hibázik, csak más lesz.
 *
 * A munkaóra-mezőnél ez konkrétan azt jelentené, hogy egy módosítás után minden
 * összesített munkaóra megváltozik, és senki nem tudná, miért.
 *
 * === MIÉRT A SÉMÁBÓL OLVAS, ÉS NEM KÉZZEL ÍRT LISTÁBÓL ===
 *
 * Egy kézzel karbantartott várt-lista pontosan az ÚJ mezőt hagyná ki -- azt,
 * amiért ez az őrző létezik. A lista ezért a sémából jön: ha valaki holnap
 * felvesz egy oszlopot a WorksheetLine modellre és nem vezeti át a másolásba,
 * EZ pirosodik ki, név szerint megnevezve a mezőt.
 *
 * === ÉS EZ NEM EGYEDI ESET: UGYANEZ AZ ALAK HÁROM HELYEN ÁLLT ELŐ EGY NAPON ===
 *
 * 2026-09-17-én három különböző helyen jelentkezett ugyanez, és külön-külön
 * három különböző hibának látszott:
 *
 *   a #801 őrző fájllistája    kézzel írt, és a három érintett fájlból egyet fedett
 *   a `lineData()` mezőlistája kézzel írt, és az új mezőt hagyta volna ki (ez itt)
 *   a #799 éles hibája         egy kézzel írt `select` blokk okozta
 *
 * Egy alak: KÉZZEL KARBANTARTOTT LISTA egy olyan halmazról, ami magától nő. És
 * mindháromnál ugyanaz a javítás, amit ez a fájl is csinál: a listát a FORRÁSBÓL
 * kell előállítani, nem kézzel vezetni.
 *
 * A kereszthivatkozás azért áll itt, mert enélkül a három eset három külön
 * tanulság marad, és a negyediket senki nem fogja felismerni.
 *
 * Nautilus mérése, 2026-09-18.
 */

const SEMA = "../../packages/database/prisma/schema.prisma";
const REPO = "src/worksheets/worksheets.repository.ts";

/**
 * Amit a másolás SZÁNDÉKOSAN nem visz át, és miért. Ez a lista rövid, és minden
 * sora indokolt -- ha hosszabbra nőne, az azt jelentené, hogy a másolás egyre
 * kevesebbet másol.
 */
const NEM_MASOLT = new Map<string, string>([
  ["id", "cuid, minden sor sajátot kap"],
  ["worksheetVersionId", "a függvény paramétere adja, nem a forrás-sorból jön"],
  ["worksheetVersion", "reláció, nem oszlop"],
  ["asset", "reláció, nem oszlop"],
]);

/** Egy `model X { ... }` blokk MEZŐNEVEI a sémából. */
function semaMezok(sema: string, modell: string): string[] {
  const start = sema.indexOf(`model ${modell} {`);
  assert.ok(start >= 0, `nincs ilyen modell a sémában: ${modell}`);
  const veg = sema.indexOf("\n}", start);
  assert.ok(veg > start, `${modell}: nem találom a modell végét`);

  const mezok: string[] = [];
  for (const sor of sema.slice(start, veg).split("\n").slice(1)) {
    const tiszta = sor.trim();
    if (!tiszta || tiszta.startsWith("//") || tiszta.startsWith("@@")) continue;
    const nev = /^([A-Za-z_][A-Za-z0-9_]*)\s/.exec(tiszta)?.[1];
    if (nev) mezok.push(nev);
  }
  return mezok;
}

/** A `lineData()` függvény törzsében szereplő objektum-kulcsok. */
function lineDataKulcsok(forras: string): string[] {
  const start = forras.indexOf("function lineData(");
  assert.ok(start >= 0, "nincs lineData függvény a repositoryban");
  const veg = forras.indexOf("\n}", start);
  assert.ok(veg > start, "nem találom a lineData végét");

  return [...forras.slice(start, veg).matchAll(/^\s{4}([A-Za-z_]\w*):/gm)].map(
    (m) => m[1]!,
  );
}

describe("a verzió-másolás minden WorksheetLine mezőt visz", () => {
  it("a séma mezői és a másolás kulcsai fedik egymást", () => {
    const sema = readFileSync(SEMA, "utf8");
    const forras = readFileSync(REPO, "utf8");

    const mezok = semaMezok(sema, "WorksheetLine");
    // POZITÍV KONTROLL: ha a séma-olvasás elromlik, egy üres lista MINDENT
    // átengedne. Tizenegynél több mezőt tart ma a modell.
    assert.ok(
      mezok.length >= 11,
      `gyanúsan kevés séma-mezőt találtam: ${mezok.join(", ")}`,
    );

    const kulcsok = new Set(lineDataKulcsok(forras));
    // UGYANAZ A KONTROLL A MÁSIK OLDALON: egy elrontott minta nulla kulcsot
    // adna, és akkor MINDEN mező hiányzónak látszana -- hangos, de hamis.
    assert.ok(
      kulcsok.size >= 11,
      `gyanúsan kevés lineData-kulcsot találtam: ${[...kulcsok].join(", ")}`,
    );

    const hianyzik = mezok.filter(
      (mezo) => !NEM_MASOLT.has(mezo) && !kulcsok.has(mezo),
    );
    assert.deepEqual(
      hianyzik,
      [],
      `a lineData() NEM másolja át ezeket a WorksheetLine mezőket: ${hianyzik.join(", ")}. ` +
        "Egy módosítás (új verzió) után az értékük elveszne, és a séma " +
        "alapértelmezésére esne vissza -- hibaüzenet nélkül.",
    );
  });
});
