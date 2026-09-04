import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  describeQueueRun,
  describeUnresolvedRecordings,
  drainQueue,
} from "./queue-runner";
import type { SyncQueueRow } from "./sync-queue";

/**
 * A KET NULLA, AMI UGYANUGY NEZ KI.
 *
 *   nulla sort mozditott, mert NEM VOLT MIT      -> minden rendben
 *   nulla sort mozditott, mert SEMMI NEM MENT FEL -> a felvitelek allnak
 *
 * Egy "lefutott" uzenetbol a ketto megkulonboztethetetlen, es a masodik a
 * dragabb: a telefonon a felvitel MAR sikeresnek latszott.
 */

const sor = (id: string): SyncQueueRow => ({
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

function deps(
  rows: SyncQueueRow[],
  valasz: (id: string) => {
    httpStatus: number | null;
    error: string | null;
    entityId?: string | null;
  },
) {
  const naplo: string[] = [];
  return {
    naplo,
    d: {
      pendingRows: () => Promise.resolve(rows),
      send: (r: SyncQueueRow) => Promise.resolve(valasz(r.id)),
      attachRecording: (operationId: string, entityId: string) => {
        naplo.push(`attach:${operationId}=${entityId}`);
        return Promise.resolve();
      },
      remove: (id: string) => {
        naplo.push(`remove:${id}`);
        return Promise.resolve();
      },
      markRetry: (id: string) => {
        naplo.push(`retry:${id}`);
        return Promise.resolve();
      },
      markConflict: (id: string) => {
        naplo.push(`conflict:${id}`);
        return Promise.resolve();
      },
      markStalled: (id: string, attemptCount: number) => {
        naplo.push(`stalled:${id}@${attemptCount}`);
        return Promise.resolve();
      },
    },
  };
}

describe("a sor végigjárása", () => {
  it("sikeres feltöltés után a sor TÉNYLEG kiürül", async () => {
    const { d, naplo } = deps([sor("a"), sor("b")], () => ({
      httpStatus: 201,
      error: null,
    }));
    const r = await drainQueue(d);
    assert.equal(r.done, 2);
    // A JELENTES NEM ELEG: azt is merjuk, hogy a TORLES megtortent.
    assert.deepEqual(naplo, ["remove:a", "remove:b"]);
  });

  it("hálózat nélkül SEMMI nem törlődik", async () => {
    const { d, naplo } = deps([sor("a")], () => ({
      httpStatus: null,
      error: null,
    }));
    const r = await drainQueue(d);
    assert.equal(r.done, 0);
    assert.equal(r.retried, 1);
    // A helyi bizonyitek MEGMARAD: ez a sor koti le, hogy nem torlunk
    // olyat, amit a szerver nem nyugtazott.
    assert.deepEqual(naplo, ["retry:a"]);
  });
});

describe("a fénykép megkapja a szerver azonosítóját", () => {
  const foto = (id: string, entityId: string | null): SyncQueueRow => ({
    ...sor(id),
    operation: "upload-photo",
    entityId,
  });

  it("a párosítás a TÖRLÉS ELŐTT megy", async () => {
    /*
      MI PIROSIT: ha a `remove` elore kerul. A sor torlese utan a rogzites
      muvelet-azonositoja mar sehol nem all, tehat a kepeket nem lehetne mihez
      kotni -- es a hiba CSENDES: a sor kiurul, a jelentes zold, a kepek
      maradnak. A sorrend maga az allitas, ezert nem eleg megszamolni a
      hivasokat.
    */
    const { d, naplo } = deps([sor("r1")], () => ({
      httpStatus: 201,
      error: null,
      entityId: "eszkoz-1",
    }));
    const r = await drainQueue(d);
    assert.equal(r.done, 1);
    assert.equal(r.unresolved, 0);
    assert.deepEqual(naplo, ["attach:r1=eszkoz-1", "remove:r1"]);
  });

  it("azonosító NÉLKÜLI siker: a sor törlődik, de KIMONDJUK", async () => {
    /*
      A rogzites FENT VAN -- egy ujrakuldes ket eszkozt csinalna belole (a
      vegpont ma nem ismeri a muvelet-azonositot). Ezert a torles helyes; a
      kepek viszont cimezhetetlenek maradnak, es ez a szam az EGYETLEN jel.
    */
    const { d, naplo } = deps([sor("r1")], () => ({
      httpStatus: 201,
      error: null,
      entityId: null,
    }));
    const r = await drainQueue(d);
    assert.equal(r.done, 1);
    assert.equal(r.unresolved, 1);
    assert.deepEqual(naplo, ["remove:r1"]);
  });

  it("egy TÉTEL sikere azonosító nélkül NEM 'cimzetlen kép'", async () => {
    /*
      A tetel sor-vegpontja nem UJ entitast hoz letre, tehat sosem ad vissza
      azonositot. A fenti allitas ("azonosito NELKULI siker") viszont pont
      ilyenkor jelezne, hogy a "hozzajuk keszult fenykepeket nem tudjuk
      feltolteni" -- olyan kepekrol, amik tetelhez nem is tartozhatnak.

      MI PIROSIT: ha a szamlalas visszaallna a puszta `operation === "create"`
      feltetelre. Ez a valtozat a fenti KET allitason tovabbra is atmenne (azok
      eszkoz-sorral mennek), tehat ez a sor az EGYETLEN, ami megfogja.
    */
    const { d, naplo } = deps(
      [{ ...sor("t1"), entityType: "worksheet-line", entityId: "lap-1" }],
      () => ({ httpStatus: 201, error: null, entityId: null }),
    );
    const r = await drainQueue(d);
    assert.equal(r.done, 1);
    assert.equal(r.unresolved, 0);
    assert.deepEqual(naplo, ["remove:t1"]);
  });

  it("egy FOTÓ sor sikere nem párosít semmit", async () => {
    // TESTVER-KONTROLL: egy valtozat, ami minden sikerre parosit, a fenti ket
    // allitason atmenne, es a kepek egymasra irnak az azonositot.
    const { d, naplo } = deps([foto("f1", "eszkoz-1")], () => ({
      httpStatus: 201,
      error: null,
      entityId: "eszkoz-9",
    }));
    const r = await drainQueue(d);
    assert.equal(r.unresolved, 0);
    assert.deepEqual(naplo, ["remove:f1"]);
  });
});

describe("a futás jelentése", () => {
  it("ÜRES sornál nincs mit mondani", () => {
    assert.equal(
      describeQueueRun({
        attempted: 0,
        done: 0,
        retried: 0,
        conflicted: 0,
        stalled: 0,
        unresolved: 0,
      }),
      null,
    );
  });

  it("a KÉT NULLA nem ugyanaz a mondat", () => {
    /*
      EZ AZ ALLITAS A MODUL LETEZESENEK OKA. Ha a "nem volt mit" es a "semmi nem
      ment fel" ugyanazt a mondatot adna, a kollega a masodikat is
      megnyugvaskent olvasna -- holott a felvitelei allnak.
    */
    const uresen = describeQueueRun({
      attempted: 0,
      done: 0,
      retried: 0,
      conflicted: 0,
      stalled: 0,
      unresolved: 0,
    });
    const sikertelen = describeQueueRun({
      attempted: 3,
      done: 0,
      retried: 3,
      conflicted: 0,
      stalled: 0,
      unresolved: 0,
    });
    assert.equal(uresen, null);
    assert.notEqual(sikertelen, null);
    assert.match(sikertelen ?? "", /Egyetlen felvitel sem ment fel/);
  });

  it("teljes sikernél kimondja, hogy MIND felment", () => {
    // ISMERT POZITIV KONTROLL: e nelkul egy "mindig panaszkodik" valtozat is
    // atmenne a fenti allitason.
    const s = describeQueueRun({
      attempted: 2,
      done: 2,
      retried: 0,
      conflicted: 0,
      stalled: 0,
      unresolved: 0,
    });
    assert.match(s ?? "", /Minden várakozó felvitel felment/);
  });

  it("RÉSZLEGES siker esetén megmondja, mennyi maradt", () => {
    const s = describeQueueRun({
      attempted: 3,
      done: 1,
      retried: 1,
      conflicted: 1,
      stalled: 0,
      unresolved: 0,
    });
    assert.match(s ?? "", /1 felvitel felment/);
    assert.match(s ?? "", /2 maradt/);
    assert.match(s ?? "", /1 elakadt/);
  });
});

describe("a címzetlen képek kimondása", () => {
  it("ha MINDEN azonosító megjött, nincs külön mondat", () => {
    // ISMERT POZITIV KONTROLL a lenti allitashoz: e nelkul egy "mindig szol"
    // valtozat is atmenne rajta.
    assert.equal(
      describeUnresolvedRecordings({
        attempted: 2,
        done: 2,
        retried: 0,
        conflicted: 0,
        stalled: 0,
        unresolved: 0,
      }),
      null,
    );
  });

  it("a fényképeket NÉV SZERINT említi, nem a rögzítés sikerét", () => {
    /*
      A `describeQueueRun` ilyenkor teljes sikert mond, es igaza is van: a
      rogzitesek felmentek. A kepekrol viszont HALLGATNA -- ez a mondat az,
      ami miatt a kollega nem olvassa a zold jelentest megnyugvaskent.
    */
    const s = describeUnresolvedRecordings({
      attempted: 2,
      done: 2,
      retried: 0,
      conflicted: 0,
      stalled: 0,
      unresolved: 2,
    });
    assert.match(s ?? "", /2 rögzítés felment/);
    assert.match(s ?? "", /fényképeket nem tudjuk feltölteni/);
  });
});
