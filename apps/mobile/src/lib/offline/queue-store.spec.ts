import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * AZ SQLITE REteg NEM UNIT-TESZTELHETO: az `expo-sqlite` natív runtime-ot
 * igenyel. Amit MEG LEHET merni, az a FORRASA -- es epp az a nehany
 * tulajdonsag, amin a felvitel megmaradasa all.
 */

const FORRAS_UT = join(
  __dirname,
  "..",
  "..",
  "..",
  "src",
  "lib",
  "offline",
  "queue-store.ts",
);

function olvas(): string {
  try {
    return readFileSync(FORRAS_UT, "utf8");
  } catch {
    throw new Error(
      `Nem tudtam elolvasni: ${FORRAS_UT}. Ez a KERESES hibaja, nem a lefedettsege -- a lenti allitasok addig semmit nem mondanak.`,
    );
  }
}

const forras = olvas();

describe("a sor tárolójának szerkezete", () => {
  it("a forrás betöltődött", () => {
    // ISMERT POZITIV KONTROLL: egy ures fajl minden lenti allitast teljesitene.
    assert.equal(forras.length > 1500, true);
    assert.match(forras, /sync_queue/);
  });

  it("az enqueue VISSZAADJA a hibát, nem nyeli el", () => {
    /*
      EZ A LEGFONTOSABB ALLITAS EBBEN A FAJLBAN.

      Az `asset-cache.ts` szandekosan ELNYELI az iras hibajat: ott a masolat
      kenyelem. ITT a sor a felvitel EGYETLEN letezo peldanya -- ha a beszuras
      elbukik es elnyeljuk, a kollega "elmentve" uzenetet lat, es a rogzites
      SEHOL nem letezik.

      MI PIROSIT: egy ures `catch {}` blokk, vagy barmi, ami nem adja tovabb a
      hibat.
    */
    assert.match(forras, /return\s*\{\s*\n?\s*ok:\s*false/);
    // ES NINCS BENNE URES CATCH. Az `asset-cache.ts` mintaja itt HIBA lenne.
    assert.doesNotMatch(forras, /catch\s*\{\s*\/\/[^\n]*\n\s*\}/);
  });

  it("a törlés CSAK azonosító szerint megy", () => {
    /*
      MI PIROSIT: egy `DELETE FROM sync_queue` feltetel nelkul, vagy allapot
      szerinti torles. Egy ilyen sor a NEM nyugtazott felviteleket is elvinne --
      es azok utan semmi nem maradna.
    */
    const torlesek = [...forras.matchAll(/DELETE FROM sync_queue[^`]*/g)].map(
      (m) => m[0].trim(),
    );
    assert.deepEqual(torlesek, ["DELETE FROM sync_queue WHERE id = ?"]);
  });

  it("a küldhető sorok listája ÁLLAPOT szerint szűr", () => {
    // Egy szures nelkuli lekerdezes a `conflict` sorokat is ujrakuldene --
    // azokat, amik emberre varnak.
    assert.match(forras, /WHERE state IN/);
    assert.match(forras, /KULDHETO/);
  });
});
