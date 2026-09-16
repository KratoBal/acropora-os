import { readFileSync } from "node:fs";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * A MOBIL TELJESÍTMÉNY-TÜKÖR EGYEZZEN A SZERVER DÖNTÉSÉVEL.
 *
 * Az Expo app nem húzhatja be a munkatér csomagjait, ezért az érték alakjának
 * szabályát MÁSOLJA. Egy másolat pontosan addig ér valamit, amíg igaz.
 *
 * MI PIROSÍT, ÉS MIÉRT ÉPP EZ: ha a két minta elcsúszik, a hiba NÉMA, és a
 * lehető legrosszabb pillanatban derül ki. A tárolt típus `decimal(19,6)`, és
 * a `Prisma.Decimal` a nem felismert szövegre DOB (mérve: a `"0,5"` alakra
 * is) -- abból pedig 500 lesz, nem 400. Offline a mentés ráadásul sorba kerül,
 * tehát a szerelő órákkal később tudná meg, hogy amit beírt, nem ment át.
 *
 * EZ A TESZT AZ API OLDALON ÁLL, mint a matrica-tükör párja: csak innen
 * látszik MIND A KÉT fájl.
 */
const SZERVER = "../../packages/types/src/unit-of-measure.ts";
const MOBIL = "../mobile/src/lib/assets/performance-mirror.ts";

function forras(ut: string): string {
  const s = readFileSync(ut, "utf8");
  // POZITIV KONTROLL A BEOLVASASRA. Egy rossz utvonal ures vagy hibas
  // tartalmat adna, es akkor a lenti allitasok ket URES halmazt vetnenek
  // ossze -- zolden.
  assert.ok(s.length > 500, `${ut}: üres vagy gyanúsan rövid`);
  return s;
}

/** A bemeneti minta, ahogy a fájlban áll. */
function minta(s: string): string {
  const m = /PERFORMANCE_VALUE_PATTERN = (\/[^;]+\/);/.exec(s);
  assert.ok(m, "nem találtam a bemeneti mintát");
  return m[1]!;
}

/**
 * A DÖNTÉS ÁGAI, SORRENDBEN: MIT AD VISSZA MIKOR.
 *
 * A FÜGGVÉNY ZÁRÓ KAPCSÁIG OLVAS, NEM FIX KARAKTERSZÁMIG -- és ezt az első
 * futás derítette ki. A rögzített ablak a mobil fájlban átcsúszott a KÖVETKEZŐ
 * függvénybe (egy `"empty"` ág jelent meg a normalizálásnál), a szerver
 * oldalán viszont egy hosszú magyarázó komment vágta el az ablakot az utolsó
 * ág ELŐTT. Ugyanaz a szám két fájlban két különböző halmazt adott.
 *
 * Vagyis a mérőeszköz volt rossz, nem a tükör. Egy ilyen eltérés ráadásul
 * mindig arra mutat, ami MOST van a fájlban: egy hozzáírt bekezdés máskor is
 * pirosra vinné, és a következő olvasó a másolatot kezdené javítani.
 */
function agak(s: string, fuggveny: string): string[] {
  const start = s.indexOf(`export function ${fuggveny}`);
  assert.notEqual(start, -1, `nem találtam: ${fuggveny}`);
  // A sor eleji `}` a fuggveny vege: a torzsben minden kapocs behuzva all.
  const veg = s.indexOf("\n}", start);
  assert.notEqual(veg, -1, `nem találtam a függvény végét: ${fuggveny}`);
  const torzs = s.slice(start, veg);
  return [...torzs.matchAll(/return ([^;]+);/g)].map((m) =>
    m[1]!.replace(/\s+/g, " ").trim(),
  );
}

describe("a mobil teljesítmény-tükör", () => {
  it("ugyanazt a bemeneti mintát használja", () => {
    assert.equal(minta(forras(MOBIL)), minta(forras(SZERVER)));
  });

  it("ugyanazokat az ágakat adja a normalizálásnál", () => {
    assert.deepEqual(
      agak(forras(MOBIL), "normalizePerformanceValue"),
      agak(forras(SZERVER), "normalizePerformanceValue"),
    );
  });

  it("ugyanazokat az ágakat adja a hiba-megnevezésnél", () => {
    assert.deepEqual(
      agak(forras(MOBIL), "performanceValueProblem"),
      agak(forras(SZERVER), "performanceValueProblem"),
    );
  });

  /**
   * POZITÍV KONTROLL A MÉRÉSRE MAGÁRA.
   *
   * A fenti három állítás akkor is zöld lenne, ha mind a hat kiolvasás üres
   * listát adna -- például egy átnevezés után, amiről senki nem tud. Ez a sor
   * mondja ki, hogy a kiolvasó TALÁL is valamit.
   */
  it("POZITÍV KONTROLL: a kiolvasás nem üres", () => {
    assert.match(minta(forras(SZERVER)), /\\d\{1,13\}/);
    assert.ok(agak(forras(SZERVER), "normalizePerformanceValue").length >= 3);
    assert.ok(agak(forras(MOBIL), "performanceValueProblem").length >= 2);
  });
});
