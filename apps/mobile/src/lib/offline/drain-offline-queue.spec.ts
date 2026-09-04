import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A HIANYZO LANCSZEM ALLITASA.
 *
 * Ez a modul nem dont semmit -- epp ez a lenyege: OSSZEKOT. Amit merni lehet
 * rajta, az az, hogy TENYLEG a valodi tarolot koti be, es nem valami mast.
 *
 * Egy fajl, ami ugy NEZ KI, mintha osszekotne, de a futtato mellett egy masik
 * (peldaul ures) alakot ad at, ugyanugy szakadas -- csak nehezebb eszrevenni.
 */

const FORRAS_UT = join(
  __dirname,
  "..",
  "..",
  "..",
  "src",
  "lib",
  "offline",
  "drain-offline-queue.ts",
);

function olvas(): string {
  try {
    return readFileSync(FORRAS_UT, "utf8");
  } catch {
    throw new Error(
      `Nem tudtam elolvasni: ${FORRAS_UT}. Ez a KERESES hibaja, nem a lefedettsege.`,
    );
  }
}

const forras = olvas();

describe("a sor futtatója a valódi tárolóra van kötve", () => {
  it("a forrás betöltődött", () => {
    // ISMERT POZITIV KONTROLL: egy ures fajl minden lenti allitast teljesitene.
    assert.equal(forras.length > 600, true);
    assert.match(forras, /drainQueue/);
  });

  it("MIND A NÉGY tároló-műveletet átadja", () => {
    /*
      MI PIROSIT: ha valamelyik kimarad vagy helyette ures alak megy at. Egy
      hianyzo `remove` eseten a sor SOSEM urulne ki, es a jelentes megis sikert
      mondana -- a felvitelek gyulnenek egy vidam uzenet alatt.
    */
    for (const nev of [
      "pendingQueueRows()",
      "await attachRecordingResult(operationId, entityId)",
      "remove: removeQueueRow",
      "markRetry: markQueueRetry",
      "markConflict: markQueueConflict",
    ]) {
      assert.match(
        forras,
        new RegExp(nev.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      );
    }
  });

  it("a küldést KÍVÜLRŐL kapja, nem itt építi", () => {
    /*
      Az API-kliens a kepernyo retegben el. Ha ide huznank, ez a modul sem lenne
      merheto -- ugyanaz a hiba egy szinttel feljebb, es epp az ellen keszult.
    */
    assert.match(forras, /send: deps\.send/);
    assert.doesNotMatch(forras, /from "@\/lib\/api/);
  });
});

describe("a három menet", () => {
  it("a MÓDOSÍTÁSOKNAK is van menete, és a kettő KÖZÖTT", () => {
    /*
      Egy menet nelkul a modositas sora BEKERULNE a tabla ba, es SOHA nem menne
      el -- a `batchForPass` menetenkent szur, tehat ami nem kap menetet, azt
      semmi nem viszi. Ez a nema alak: a szerelo "vár feltöltésre" uzenetet lat,
      es a varakozas soha nem er veget.

      A HELYE IS ALLITAS. A rogzitesek ELE nem kerulhet (egy uj eszkoz az, ami
      elveszne, ha a telefon lemerul), a kepek MOGE sem (a kepek varakozasa a
      rogzitesekrol szol, a modositasnak ahhoz semmi koze).

      MI PIROSIT: a menet elhagyasa, vagy a sorrend felcserelese.
    */
    const menetek = [...forras.matchAll(/egyMenet\(deps, "([a-z-]+)"\)/g)].map(
      (m) => m[1],
    );
    assert.deepEqual(menetek, ["create", "update", "upload-photo"]);
  });

  it("a RÖGZÍTÉSEK mennek elöl, a KÉPEK utánuk", () => {
    /*
      A ket menet MAGA a sorrend: egy kep egy MAR LETEZO szerver-oldali
      eszkozhoz kapcsolodik, tehat amig a rogzites nem ment fel, nincs mihez
      kapcsolodnia.

      MI PIROSIT: egyetlen menet. Akkor a kepek a rogzitesekkel EGYUTT
      indulnanak, es a szerver utasitana el oket.
    */
    assert.match(forras, /egyMenet\(deps, "create"\)/);
    assert.match(forras, /egyMenet\(deps, "upload-photo"\)/);
  });

  it("a második menet ÚJRAOLVASSA a sort", () => {
    /*
      Az elso menet kozben a kepek sorara felkerul a szerver-azonosito. Ha a
      masodik menet az elso ELOTT kiolvasott sorokbol dolgozna, minden kep
      gazdatlannak latszana, es SOHA egy sem menne fel.

      MI PIROSIT: ha a `pendingQueueRows` hivas kikerul a menetbol egy kozos,
      egyszer kiolvasott listaba.
    */
    assert.match(forras, /const sorok = \(await pendingQueueRows\(\)\)/);
    assert.match(forras, /batchForPass\(sorok, muvelet\)/);
  });

  it("a MENET TARTALMÁT a batchForPass dönti el, nem a lekérdezés", () => {
    /*
      A szabaly a `photo-queue.ts`-ben all, es ott VISELKEDESSEL is meg van
      kotve (`batchForPass` specje). Ez a sor csak a HIVAS -- e nelkul a szabaly
      le lenne irva, es senki nem kerdezne meg.
    */
    assert.match(forras, /batchForPass\(/);
  });
});

describe("a várakoztatás", () => {
  it("a sorok a KISERLET ÓTA ELTELT IDŐ szerint is szűrődnek", () => {
    /*
      A kiuritest esemeny inditja, nem idozito: nincs, ami kesobb visszajonne.
      Amit tenni lehet, az az, hogy a KOVETKEZO alkalommal atugorjuk azt a sort,
      aminek az elozo kiserlete ota meg nem telt el eleg ido -- kulonben egy
      sorozatosan buko tetel minden halozat-valtasnal ujra elindul.

      MI PIROSIT: a szures elhagyasa. A dontes maga (`isDueForRetry`) a
      `queue-drain.ts`-ben all, es ott VISELKEDESSEL is meg van kotve.
    */
    assert.match(forras, /isDueForRetry\(row, most\)/);
  });

  it("a MEGÁLLT sorokat is a valódi tárolóra köti", () => {
    // MI PIROSIT: ha a `markStalled` kimaradna. A futtato akkor a megallt
    // soroknal semmit nem irna, es a tetel a kovetkezo futasban ujra elindulna
    // -- vagyis a felso hatar szolna, es nem allitana meg semmit.
    assert.match(forras, /markStalled: markQueueStalled/);
  });
});
