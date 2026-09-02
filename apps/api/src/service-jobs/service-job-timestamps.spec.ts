import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { serviceJobMoveTimestamps } from "./service-job-timestamps.js";

const now = new Date("2026-09-02T10:00:00.000Z");

describe("mit ír a lépés a jegy időbélyegeibe", () => {
  /**
   * A MEZŐ MÁSOLAT, A NAPLÓSOR A FORRÁS, és ez az állítás azt méri, hogy a
   * másolat UGYANAZT az időpontot kapja, mint amit a naplósor kap. A
   * tárolóréteg mindkettőbe ugyanazt a `now`-t teszi; ha valaki később egy
   * második `new Date()`-et vezet be, a két érték elcsúszik, és onnantól nem
   * lehet megmondani, hogy az eltérés hiba-e vagy a mérés pontatlansága.
   */
  it("a kezdés a lépés időpontját kapja, nem egy másik órát", () => {
    assert.deepEqual(serviceJobMoveTimestamps("IN_PROGRESS", now), {
      startedAt: now,
    });
  });

  it("a befejezés is a lépés időpontját kapja", () => {
    assert.deepEqual(serviceJobMoveTimestamps("COMPLETED", now), {
      completedAt: now,
    });
  });

  /**
   * A TILTOTT ESETEKET MÉRŐ ÁLLÍTÁSOK, NÉV SZERINT.
   *
   * Egy készlet, ami csak azt nézi, hogy a két megengedett lépés ír, akkor is
   * zöld maradna, ha MINDEN lépés írna mindkét mezőt. Az elállt jegy lezárult,
   * de nem készült el: egy `completedAt` rajta a számlázásnak hazudna.
   */
  it("az elállt jegy NEM kap befejezési időpontot", () => {
    assert.deepEqual(serviceJobMoveTimestamps("CANCELLED", now), {});
  });

  it("a köztes lépések egyik mezőt sem írják", () => {
    for (const to of [
      "TRIAGED",
      "SCHEDULED",
      "WAITING_FOR_PARTS",
      "WAITING_FOR_CUSTOMER",
    ] as const) {
      assert.deepEqual(serviceJobMoveTimestamps(to, now), {}, to);
    }
  });
});
