import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  acknowledgedRecordings,
  batchForPass,
  describePhotoBacklog,
  nextBatch,
  photoOperationId,
} from "./photo-queue";
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
  lastAttemptAt: null,
  state: "pending",
});

const modositas = (id: string): SyncQueueRow => ({
  ...rogzites(id),
  operation: "update",
  entityId: "asset-1",
  payloadJson: JSON.stringify({
    assetName: "Szivattyú",
    patch: { expectedUpdatedAt: "2026-09-04T08:00:00Z", status: "ACTIVE" },
  }),
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

  it("a MÓDOSÍTÁS akkor is mehet, ha rögzítés vár", () => {
    /*
      A ket menet oka a FUGGOSEG, es a modositasnak nincs ilyenje: a celpontja
      MAR a szerveren all, kulonben nem lehetne szerkeszteni.

      MI PIROSIT: ha az elso ag csak a rogziteseket adna vissza. Akkor egy
      ismetelten elbukó felvitel (ami `failed` allapotban a sorban MARAD)
      VEGTELENUL feltartana minden javitast a telefonon.
    */
    const batch = nextBatch([rogzites("r1"), modositas("m1")], new Set());
    assert.deepEqual(
      batch.map((r) => r.id),
      ["r1", "m1"],
    );
  });

  it("a MÓDOSÍTÁS akkor is mehet, ha nincs rögzítés", () => {
    // A masik ag. Egy modositas soha nem var senkire.
    const batch = nextBatch([modositas("m1")], new Set());
    assert.deepEqual(
      batch.map((r) => r.id),
      ["m1"],
    );
  });

  it("a menet szűrése a MÓDOSÍTÁSOKAT külön adja", () => {
    /*
      A `batchForPass` az, amit a kiurites tenylegesen hiv. Ha a modositas
      benne lenne a `nextBatch` kimeneteben, de a menet-szures nem ismerne,
      ugyanugy sosem menne el.
    */
    const sorok = [rogzites("r1"), modositas("m1"), foto("f1", "r1")];
    assert.deepEqual(
      batchForPass(sorok, "update").map((r) => r.id),
      ["m1"],
    );
    // TESTVER-KONTROLL: a rogzites menete NEM viszi el a modositast.
    assert.deepEqual(
      batchForPass(sorok, "create").map((r) => r.id),
      ["r1"],
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

describe("a kép sorának azonosítója", () => {
  it("UGYANAZ a kép ugyanahhoz a rögzítéshez UGYANAZT az azonosítót kapja", () => {
    /*
      A ketszer megnyomott gomb ugyanazt a kulcsot adja, es a beszuras
      (`INSERT OR IGNORE`) csendben elesik. Enelkul ugyanaz a kep KETSZER menne
      fel, ket kulon dokumentumkent az eszkoz lapjan.
    */
    const a = photoOperationId({
      recordingOperationId: "r1",
      uri: "file:///kep.jpg",
    });
    const b = photoOperationId({
      recordingOperationId: "r1",
      uri: "file:///kep.jpg",
    });
    assert.equal(a, b);
  });

  it("ugyanaz a fájl KÉT rögzítéshez KÉT azonosító", () => {
    /*
      MI PIROSIT: ha a kulcs csak az `uri`-bol keszulne. A szerelo ugyanazt a
      kepet valaszthatja ket eszkozhoz, es akkor a masodik felvitel kepe
      csendben elveszne -- a beszuras "mar letezik" cimen eldobna.
    */
    assert.notEqual(
      photoOperationId({ recordingOperationId: "r1", uri: "file:///kep.jpg" }),
      photoOperationId({ recordingOperationId: "r2", uri: "file:///kep.jpg" }),
    );
  });
});

describe("melyik rögzítések mentek már fel", () => {
  it("a kép SZERVER-AZONOSÍTÓJA a bizonyíték", () => {
    /*
      A rogzites sora a nyugtazaskor TOROLVE lesz, tehat a "mar felment"
      tenynek egyetlen nyoma marad: a kep sorara felirt azonosito. Ezt a
      halmazt NEM lehet a rogzites-sorok hianyabol kikovetkeztetni -- a hianyzas
      azt is jelentheti, hogy a rogzites SOSEM letezett.
    */
    const felment = { ...foto("f1", "r1"), entityId: "eszkoz-1" };
    assert.deepEqual([...acknowledgedRecordings([felment])], ["r1"]);
  });

  it("azonosító NÉLKÜL a rögzítés nem számít felmentnek", () => {
    // MI PIROSIT: ha a halmaz minden fotobol venne a rogzites azonositojat.
    // Akkor a sajat kepe "igazolna" a rogzitest, es a gazdatlan kep vedelme
    // (`nextBatch`) sosem sulne el.
    assert.deepEqual([...acknowledgedRecordings([foto("f1", "r1")])], []);
  });

  it("a RÖGZÍTÉS sorai nem kerülnek bele", () => {
    // TESTVER-KONTROLL: egy valtozat, ami minden sorbol gyujt, itt bukna.
    assert.deepEqual([...acknowledgedRecordings([rogzites("r1")])], []);
  });
});

describe("egy menet sorai", () => {
  it("az ELBUKOTT rögzítés NEM indul el a második menetben", () => {
    /*
      EZ AZ ALLITAS A SZURES LETEZESENEK OKA. Egy elbukott rogzites `failed`
      allapotba kerul, ami tovabbra is kuldheto -- vagyis szures nelkul
      ugyanaz a felvitel KETSZER menne el EGYETLEN futasban, es a szerveren ket
      eszkoz keletkezne. A vegpont ma nem ismeri a muvelet-azonositot, tehat a
      masodik peldanyt nem tudna kiszurni.

      MI PIROSIT: a muvelet szerinti szures elhagyasa.
    */
    const bukott: SyncQueueRow = { ...rogzites("r1"), state: "failed" };
    assert.deepEqual(
      batchForPass([bukott], "upload-photo").map((r) => r.id),
      [],
    );
    // ISMERT POZITIV KONTROLL: ugyanaz a sor az ELSO menetben elindul.
    assert.deepEqual(
      batchForPass([bukott], "create").map((r) => r.id),
      ["r1"],
    );
  });

  it("a MÁSODIK menet a címzett képet viszi", () => {
    const cimzett: SyncQueueRow = { ...foto("f1", "r1"), entityId: "eszkoz-1" };
    assert.deepEqual(
      batchForPass([cimzett], "upload-photo").map((r) => r.id),
      ["f1"],
    );
  });

  it("amíg VAN fel nem ment rögzítés, a második menet ÜRES", () => {
    // A ket menet MAGA a sorrend: a kep egy MAR LETEZO szerver-oldali eszkozhoz
    // kapcsolodik, tehat amig a rogzites all, nincs mihez kapcsolodnia.
    const cimzett: SyncQueueRow = { ...foto("f1", "r1"), entityId: "eszkoz-1" };
    assert.deepEqual(
      batchForPass([rogzites("r2"), cimzett], "upload-photo").map((r) => r.id),
      [],
    );
  });
});
