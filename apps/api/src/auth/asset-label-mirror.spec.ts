import { readFileSync } from "node:fs";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * A MOBIL MATRICA-TÜKÖR EGYEZZEN A SZERVER DÖNTÉSÉVEL.
 *
 * Az Expo app nem húzhatja be a munkatér csomagjait (saját npm lockfile, lásd
 * `docs/MOBILE-DEVELOPMENT.md`), ezért a matricakód szabályát MÁSOLJA. Egy
 * másolat pontosan addig ér valamit, amíg igaz.
 *
 * MI PIROSÍT, ÉS MIÉRT PONT EZ A HÁROM: ha a kettő elcsúszik, a hiba NÉMA és a
 * ROSSZ pillanatban derül ki. A szerelő a helyszínen kitölti az űrlapot, az
 * átengedi, és a mentés utasítja el -- vagy fordítva: az űrlap megtagad egy
 * kódot, amit a szerver elfogadna.
 *
 * EZ A TESZT AZ API OLDALON ÁLL, mint a jogosultsági tükör párja
 * (`mobile-capability-mirror.spec.ts`): csak innen látszik MIND A KÉT fájl.
 */
const SZERVER = "../../packages/types/src/asset-label.ts";
const MOBIL = "../mobile/src/lib/assets/asset-label-mirror.ts";

function forras(ut: string): string {
  const s = readFileSync(ut, "utf8");
  // POZITIV KONTROLL A BEOLVASASRA. Egy rossz utvonal ures vagy hibas
  // tartalmat adna, es akkor a lenti egyezes-allitasok ket URES halmazt
  // hasonlitananak ossze -- zolden.
  assert.ok(s.length > 500, `${ut}: üres vagy gyanúsan rövid`);
  return s;
}

/** A bemeneti minta, ahogy a fájlban áll. */
function minta(s: string): string {
  const m = /ASSET_LABEL_CODE_PATTERN = (\/[^;]+\/);/.exec(s);
  assert.ok(m, "nem találtam a bemeneti mintát");
  return m[1]!;
}

/** A kötelezőség kapcsolójának ÉRTÉKE. */
function kotelezo(s: string): string {
  const m = /ASSET_LABEL_REQUIRED_ON_CREATE = (true|false);/.exec(s);
  assert.ok(m, "nem találtam a kötelezőség kapcsolóját");
  return m[1]!;
}

/** A döntés ágai, sorrendben: mit ad vissza mikor. */
function agak(s: string): string[] {
  const start = s.indexOf("export function assetLabelCreateProblem");
  assert.notEqual(start, -1, "nem találtam a döntés függvényét");
  const torzs = s.slice(start, start + 600);
  return [...torzs.matchAll(/return ([^;]+);/g)].map((m) =>
    m[1]!.replace(/\s+/g, " ").trim(),
  );
}

describe("a mobil matrica-tükör", () => {
  it("ugyanazt a bemeneti mintát használja", () => {
    assert.equal(minta(forras(MOBIL)), minta(forras(SZERVER)));
  });

  it("ugyanazt mondja a kötelezőségről", () => {
    assert.equal(kotelezo(forras(MOBIL)), kotelezo(forras(SZERVER)));
  });

  it("a döntés ágai szó szerint egyeznek", () => {
    assert.deepEqual(agak(forras(MOBIL)), agak(forras(SZERVER)));
  });

  it("a kivágás tényleg talált ágakat, nem üres halmazt", () => {
    // ISMERT POZITIV KONTROLL: ket ures tomb `deepEqual` szerint egyezik,
    // tehat a fenti allitas ONMAGABAN akkor is zold lenne, ha a kivagas
    // elromlana. Ez a sor azt zarja ki.
    assert.ok(agak(forras(SZERVER)).length >= 2);
  });
});
