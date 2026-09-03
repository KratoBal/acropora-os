import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { describeOfflineSession } from "./offline-session-notice";

/**
 * AZ A BAJ, AMIT EZ MEGELOZ: az app elindul, minden mukodik, es a kollega NEM
 * TUDJA, hogy a jogkorei a legutobbi ellenorzes szerintiek. Egy azota
 * visszavont jogosultsag legfeljebb 24 oraig nem latszik -- ez Balazs
 * dontesenek az ara, es csak akkor szamolhato vele, ha ki van mondva.
 */

const MOST = new Date("2026-09-03T12:00:00Z");
const ora = (n: number) =>
  new Date(MOST.getTime() - n * 3_600_000).toISOString();

describe("az offline munkamenet jelzése", () => {
  it("ONLINE indulásnál NINCS mit kiírni", () => {
    /*
      TESTVER-KONTROLL, es ez a fontosabbik: egy valtozat, ami MINDIG kiirja a
      savot, minden indulasnal azt allitana, hogy nincs halozat. A felhasznalo
      harmadszorra nem olvassa el, es akkor az igazi eset is elveszik.
    */
    assert.equal(
      describeOfflineSession({
        offline: false,
        lastVerifiedAt: ora(2),
        now: MOST,
      }),
      null,
    );
  });

  it("offline indulásnál kiírja, HÁNY ÓRÁIG megy még így", () => {
    const n = describeOfflineSession({
      offline: true,
      lastVerifiedAt: ora(2),
      now: MOST,
    });
    assert.equal(n?.title, "Offline mód");
    // 24 - 2 = 22 ora van hatra.
    assert.match(n?.body ?? "", /22 óráig/);
    assert.match(n?.body ?? "", /legutóbbi ellenőrzés/);
  });

  it("ismeretlen ellenőrzési idővel is kiír valamit, csak óraszám nélkül", () => {
    /*
      MI PIROSIT: ha a hianyzo idobelyeg eseten `null`-t adnank vissza. Akkor az
      app offline indulna, es SEMMI nem mondana meg -- vagyis epp abban az
      esetben hallgatnank, amikor a legkevesebbet tudjuk.
    */
    const n = describeOfflineSession({
      offline: true,
      lastVerifiedAt: null,
      now: MOST,
    });
    assert.notEqual(n, null);
    assert.doesNotMatch(n?.body ?? "", /óráig/);
  });

  it("SOHA nem ír nulla órát", () => {
    /*
      A "0 óráig" azt sugallna, hogy epp most jart le -- holott akkor az app el
      sem indult volna. A hatar 23 ora 59 percnel meg egy megkezdett ora.
    */
    const n = describeOfflineSession({
      offline: true,
      lastVerifiedAt: ora(23.99),
      now: MOST,
    });
    assert.match(n?.body ?? "", /1 óráig/);
    assert.doesNotMatch(n?.body ?? "", /0 óráig/);
  });
});
