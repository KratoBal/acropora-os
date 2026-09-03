import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { describePhotoBacklog, nextBatch } from "./photo-queue";
import type { SyncQueueRow } from "./sync-queue";

/**
 * A MERCE, ES NEM AZ, AMI KEZENFEKVO.
 *
 * NEM az a kerdes, hogy a rogzites felkerul-e, hanem hogy a FOTO KESOBB
 * felkerul-e. Egy rogzites, ami sosem kapja meg a kepeit, SIKERES SZINKRONNAK
 * latszik: a sor kiurult a rogzitesektol, a jelentes zold, es a kep nincs sehol.
 */

const rogzites = (id: string): SyncQueueRow => ({
  id,
  operation: "create",
  entityType: "asset",
  entityId: null,
  payloadJson: "{}",
  createdAt: "2026-09-03T09:00:00Z",
  attemptCount: 0,
  lastError: null,
  state: "pending",
});

const foto = (id: string, rogzitesId: string): SyncQueueRow => ({
  ...rogzites(id),
  operation: "upload-photo",
  payloadJson: JSON.stringify({
    uri: "file:///kep.jpg",
    name: "kep.jpg",
    type: "image/jpeg",
    recordingOperationId: rogzitesId,
  }),
});

describe("mi mehet fel most", () => {
  it("amíg VAN fel nem ment rögzítés, a fotók VÁRNAK", () => {
    /*
      Nem gyorsitasi kerdes: egy kep, aminek a rogzitese meg a sorban all, nem
      tud HOVA felkerulni -- a szerver-oldali azonosito meg nem letezik.
    */
    const batch = nextBatch([rogzites("r1"), foto("f1", "r1")], new Set());
    assert.deepEqual(
      batch.map((r) => r.id),
      ["r1"],
    );
  });

  it("a rögzítés UTÁN a hozzá tartozó fotó megy", () => {
    // ISMERT POZITIV KONTROLL: e nelkul egy "sosem kuld fotot" valtozat is
    // atmenne a fenti allitason.
    const batch = nextBatch([foto("f1", "r1")], new Set(["r1"]));
    assert.deepEqual(
      batch.map((r) => r.id),
      ["f1"],
    );
  });

  it("a GAZDÁTLAN fotó NEM megy el", () => {
    /*
      MI PIROSIT: ha a szures csak az `operation`-t nezne. Egy kep, aminek a
      rogzitese sem a sorban, sem a felmentek kozott nincs, a szerveren hibat
      adna -- a sor konfliktusnak sorolna, es a kep OROKRE elakadna.
    */
    const batch = nextBatch([foto("f1", "elveszett")], new Set(["r1"]));
    assert.deepEqual(batch, []);
  });
});

describe("a hátralék kimondása", () => {
  it("ÜRESEN nincs mit mondani", () => {
    assert.equal(describePhotoBacklog({ recordings: 0, photos: 0 }), null);
  });

  it("a FOTÓ-hátralékot KÜLÖN mondja, akkor is, ha minden rögzítés felment", () => {
    /*
      EZ AZ ALLITAS A MODUL LETEZESENEK OKA. Ez az az allapot, ami "sikeres
      szinkronnak" latszana, ha csak a rogziteseket szamolnank: nulla rogzites
      var, es kozben harom kep sosem ment fel.
    */
    const s = describePhotoBacklog({ recordings: 0, photos: 3 });
    assert.match(s ?? "", /3 fénykép még nem ment fel/);
    assert.match(s ?? "", /már rögzített/);
  });

  it("csak rögzítésnél nem beszél fotóról", () => {
    // TESTVER-KONTROLL: egy valtozat, ami mindig emliti a fotokat, a fenti
    // allitason atmenne, es minden uzenetben ott lenne egy nulla.
    const s = describePhotoBacklog({ recordings: 2, photos: 0 });
    assert.doesNotMatch(s ?? "", /fénykép/);
  });
});
