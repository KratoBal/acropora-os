import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SimplePayOpenLinesScheduler,
  simplePayReprocessScheduleOn,
} from "./simplepay-open-lines.scheduler.js";
import type { SimplePaySettlementService } from "./simplepay-settlement.service.js";

/**
 * THE HOURLY RE-DECISION OF THE OPEN SIMPLEPAY LINES (Balázs 2026-11-27: three payments said "nincs számlája" days after their
 * invoices were tied to the orders). WHAT TURNS IT RED: the schedule off by default, or on despite an off value; a failed run
 * throwing out of the scheduler; two runs at once; a timer set while switched off.
 */
const service = (
  reprocessOpen: () => Promise<{ reports: number; resolved: number }>,
) => ({ reprocessOpen }) as unknown as SimplePaySettlementService;

describe("SimplePayOpenLinesScheduler", () => {
  it("is on by default; 0, false, off and no switch it off, anything else keeps it on", () => {
    assert.equal(simplePayReprocessScheduleOn({}), true);
    for (const off of ["0", "false", "off", "no", " OFF "])
      assert.equal(
        simplePayReprocessScheduleOn({ SIMPLEPAY_REPROCESS_SCHEDULE: off }),
        false,
        off,
      );
    for (const on of ["1", "true", "yes", ""])
      assert.equal(
        simplePayReprocessScheduleOn({ SIMPLEPAY_REPROCESS_SCHEDULE: on }),
        true,
        on,
      );
  });

  it("a run re-decides the open lines and says how many resolved", async () => {
    let calls = 0;
    const scheduler = new SimplePayOpenLinesScheduler(
      service(async () => {
        calls += 1;
        return { reports: 2, resolved: 3 };
      }),
      {},
    );
    assert.deepEqual(await scheduler.runOnce(), {
      status: "RAN",
      reports: 2,
      resolved: 3,
    });
    assert.equal(calls, 1);
  });

  it("a failed run stays inside the run, and the next one runs again", async () => {
    let fail = true;
    const scheduler = new SimplePayOpenLinesScheduler(
      service(async () => {
        if (fail) throw new Error("adatbazis");
        return { reports: 0, resolved: 0 };
      }),
      {},
    );
    assert.deepEqual(await scheduler.runOnce(), { status: "FAILED" });
    fail = false;
    assert.deepEqual(await scheduler.runOnce(), {
      status: "RAN",
      reports: 0,
      resolved: 0,
    });
  });

  it("does not start a second run while one is going", async () => {
    let release!: () => void;
    const scheduler = new SimplePayOpenLinesScheduler(
      service(
        () =>
          new Promise((resolve) => {
            release = () => resolve({ reports: 1, resolved: 0 });
          }),
      ),
      {},
    );
    const first = scheduler.runOnce();
    assert.deepEqual(await scheduler.runOnce(), { status: "SKIPPED" });
    release();
    assert.equal((await first).status, "RAN");
  });

  it("switched off, it sets no timer; on, it does, and stopping clears it", () => {
    const timerOf = (s: SimplePayOpenLinesScheduler) =>
      (s as unknown as { timer: NodeJS.Timeout | null }).timer;
    const off = new SimplePayOpenLinesScheduler(
      service(async () => ({ reports: 0, resolved: 0 })),
      {
        SIMPLEPAY_REPROCESS_SCHEDULE: "0",
      },
    );
    off.onModuleInit();
    assert.equal(timerOf(off), null);
    const on = new SimplePayOpenLinesScheduler(
      service(async () => ({ reports: 0, resolved: 0 })),
      {},
    );
    on.onModuleInit();
    assert.notEqual(timerOf(on), null);
    on.onModuleDestroy();
    assert.equal(timerOf(on), null);
  });
});
