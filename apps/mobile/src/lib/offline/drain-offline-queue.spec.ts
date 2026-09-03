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
      "pendingRows: pendingQueueRows",
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
