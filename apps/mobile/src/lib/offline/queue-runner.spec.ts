import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { describeQueueRun, drainQueue } from "./queue-runner";
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
  state: "pending",
});

function deps(
  rows: SyncQueueRow[],
  valasz: (id: string) => { httpStatus: number | null; error: string | null },
) {
  const naplo: string[] = [];
  return {
    naplo,
    d: {
      pendingRows: () => Promise.resolve(rows),
      send: (r: SyncQueueRow) => Promise.resolve(valasz(r.id)),
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

describe("a futás jelentése", () => {
  it("ÜRES sornál nincs mit mondani", () => {
    assert.equal(
      describeQueueRun({ attempted: 0, done: 0, retried: 0, conflicted: 0 }),
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
    });
    const sikertelen = describeQueueRun({
      attempted: 3,
      done: 0,
      retried: 3,
      conflicted: 0,
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
    });
    assert.match(s ?? "", /Minden várakozó felvitel felment/);
  });

  it("RÉSZLEGES siker esetén megmondja, mennyi maradt", () => {
    const s = describeQueueRun({
      attempted: 3,
      done: 1,
      retried: 1,
      conflicted: 1,
    });
    assert.match(s ?? "", /1 felvitel felment/);
    assert.match(s ?? "", /2 maradt/);
    assert.match(s ?? "", /1 elakadt/);
  });
});
