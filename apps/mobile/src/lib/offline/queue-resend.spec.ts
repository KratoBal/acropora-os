import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { queueResendEligibility, queueResendPatch } from "./queue-resend";

/**
 * MELYIK SOR JAVITHATO, ES MI TORTENIK VELE.
 *
 * A kepernyo torzsere nincs komponens-teszt ebben az appban, es ez a dontes
 * abban a helyzetben sul el, ahol a legdragabb kiprobalni: a helyszinen, egy
 * elakadt felvitel felett.
 */

const elakadtEszkoz = {
  state: "conflict",
  operation: "create",
  entityType: "asset",
};

describe("melyik sor javítható és küldhető újra", () => {
  it("elakadt eszköz-felvitel: igen", () => {
    assert.deepEqual(queueResendEligibility(elakadtEszkoz), { ok: true });
  });

  it("ami nem akadt el, azt nem javítjuk", () => {
    /*
      MI PIROSIT: az allapot-ellenorzes elhagyasa. Akkor egy VARAKOZO soron is
      megjelenne a javitas gomb -- es a szerelo atirna egy felvitelt, ami epp
      uton van a szerverre. A ket torzs kozul az egyik nemán elveszne.
    */
    for (const state of ["pending", "syncing", "failed"]) {
      const d = queueResendEligibility({ ...elakadtEszkoz, state });
      assert.equal(d.ok, false, state);
      assert.equal(!d.ok && d.reason, "not-conflicted", state);
    }
  });

  it("fénykép-soron nincs mit átírni", () => {
    const d = queueResendEligibility({
      ...elakadtEszkoz,
      operation: "upload-photo",
    });
    assert.equal(d.ok, false);
    assert.equal(!d.ok && d.reason, "not-a-create");
  });

  it("munkalap-felvitel: SZÁNDÉKOS szűkítés, és az üzenet ezt ki is mondja", () => {
    /*
      EZ NEM HIANY, HANEM IDOZITETT HATAR. Az uzenet azert allitando, mert a
      kepernyon ez az EGYETLEN hely, ahol a szerelo megtudja, hogy nem hiba,
      amibe utkozott. Egy puszta "nem lehet" ugyanugy nez ki, mint egy torott
      funkcio.

      MI PIROSIT: ha valaki a szoveget egy semleges "nem lehet"-re csereli.
    */
    const d = queueResendEligibility({
      ...elakadtEszkoz,
      entityType: "worksheet",
    });
    assert.equal(d.ok, false);
    assert.equal(!d.ok && d.reason, "unsupported-entity");
    assert.ok(!d.ok && d.message.includes("Szándékos"), !d.ok ? d.message : "");
  });

  it("a VÁRAKOZÓ fényképről az állapotát mondja, nem a fajtáját", () => {
    /*
      A SORREND MERESE. Egy varakozo fenykep-sorra MIND A KET elutasitas igaz
      lenne. Az elso mondat arrol szoljon, ami MOST all fenn: meg el sem
      indult. MI PIROSIT: a ket ellenorzes felcserelese.
    */
    const d = queueResendEligibility({
      state: "pending",
      operation: "upload-photo",
      entityType: "asset",
    });
    assert.equal(!d.ok && d.reason, "not-conflicted");
  });
});

describe("mit változtat az újraküldés a soron", () => {
  it("az új törzs megy, az állapot újra várakozó", () => {
    assert.deepEqual(queueResendPatch('{"name":"javított"}'), {
      payloadJson: '{"name":"javított"}',
      state: "pending",
      attemptCount: 0,
      lastError: null,
    });
  });

  it("a kísérletszám NULLÁZÓDIK", () => {
    /*
      MI PIROSIT: ha a javitott sor megtartana a regi kiserletszamot. Akkor egy
      olyan sor, ami mar gyujtott nehany szerver-hibat, a javitas utan egy-ket
      probalkozassal azonnal a megallasi hatarba futna -- ugy, hogy kozben MAS
      torzset kuld, mint amivel a hibak keletkeztek. Az uj torzs uj felvitel a
      szerver szemszogebol; a regi kiserletek rola semmit nem mondanak.
    */
    assert.equal(queueResendPatch("{}").attemptCount, 0);
  });

  it("a régi hibaüzenet törlődik", () => {
    /*
      Egy megmarado hibauzenet a kepernyon a REGI bukast magyarazna egy MAR
      ATIRT sor mellett -- olvashato, hiheto, es hamis.
    */
    assert.equal(queueResendPatch("{}").lastError, null);
  });
});
