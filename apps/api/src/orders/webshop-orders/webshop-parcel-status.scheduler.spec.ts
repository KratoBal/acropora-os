import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  WebshopParcelStatusScheduler,
  parcelStatusSyncConfig,
} from "./webshop-parcel-status.scheduler.js";
import type {
  ParcelStatusSyncReport,
  ParcelSyncCarrier,
} from "./webshop-parcel-status-sync.js";

// What this proves (card ef84489d): the status the health endpoint reads. MI PIROSIT: a futas jelentese nem kerul a memoriaba (az observe
// mod nem merheto); a lezart rendelesek AZONOSITOI kiszivarognak a nezetbe (csak darabszam mehet); a kapcsolo "true"-nal tagabb ertekre
// is bekapcsoltnak latszik; egy hibas beallitas ures nezetet ad a ok helyett; egy bukott futas "ok"-nak latszik, vagy a hibaszoveg
// (nem kod) kerul ki; a ket szallito osszekeveredik; az observe mod a beallitott kodoktol fuggetlen.
const REPORT = (carrier: ParcelSyncCarrier): ParcelStatusSyncReport => ({
  carrier,
  checked: 5,
  closed: ["order_SECRET_1", "order_SECRET_2"],
  alreadyClosed: 1,
  waiting: 2,
  skipped: [{ orderId: "order_SECRET_3", status: "confirmed" }],
  failed: [{ orderId: "order_SECRET_4", error: "HTTP_502" }],
  observed: [{ code: "RECEIVE", description: "Átvéve", parcels: 4 }],
  configuredCodes: [],
  notifyCustomer: false,
  truncated: false,
});

const AT = new Date("2026-11-19T07:00:00.000Z");
const scheduler = (
  run: (
    env: NodeJS.ProcessEnv,
    now: Date,
    carrier: ParcelSyncCarrier,
  ) => Promise<ParcelStatusSyncReport>,
) => new WebshopParcelStatusScheduler({ run } as never, () => AT);

describe("WebshopParcelStatusScheduler.allapot", () => {
  it("before any run: nothing recorded, the switches read from the environment", () => {
    const s = scheduler(async () => REPORT("gls"));
    const status = s.allapot({
      FOXPOST_STATUS_SYNC_ENABLED: "true",
      FOXPOST_STATUS_SYNC_INTERVAL_MINUTES: "30",
    } as never);
    assert.equal(status.carriers.foxpost.enabled, true);
    assert.equal(status.carriers.foxpost.intervalMinutes, 30);
    assert.equal(status.carriers.foxpost.lastRunAt, null);
    assert.equal(status.carriers.foxpost.lastReport, null);
    assert.equal(status.carriers.gls.enabled, false);
    assert.equal(status.carriers.gls.intervalMinutes, null);
    assert.equal(status.notifyCustomer, false);
  });

  it("only the exact string true switches a carrier or the customer mail on", () => {
    const s = scheduler(async () => REPORT("gls"));
    for (const v of ["TRUE", "1", "yes", " true", ""]) {
      const status = s.allapot({
        FOXPOST_STATUS_SYNC_ENABLED: v,
        GLS_STATUS_SYNC_ENABLED: v,
        PARCEL_STATUS_SYNC_NOTIFY_CUSTOMER: v,
      } as never);
      assert.equal(status.carriers.foxpost.enabled, false, v);
      assert.equal(status.carriers.gls.enabled, false, v);
      assert.equal(status.notifyCustomer, false, v);
    }
    assert.equal(
      s.allapot({ PARCEL_STATUS_SYNC_NOTIFY_CUSTOMER: "true" } as never)
        .notifyCustomer,
      true,
    );
  });

  it("a run's report is kept as counts and codes, the order identifiers do not reach the view", async () => {
    const s = scheduler(async (_env, _now, carrier) => REPORT(carrier));
    await s.runOnce("foxpost");
    const status = s.allapot({ FOXPOST_STATUS_SYNC_ENABLED: "true" } as never);
    const foxpost = status.carriers.foxpost;
    assert.equal(foxpost.lastRunAt, AT.toISOString());
    assert.equal(foxpost.lastOutcome, "ok");
    assert.deepEqual(foxpost.lastReport, {
      checked: 5,
      closed: 2,
      alreadyClosed: 1,
      waiting: 2,
      skipped: 1,
      failed: 1,
      observed: [{ code: "RECEIVE", description: "Átvéve", parcels: 4 }],
      configuredCodes: [],
      notifyCustomer: false,
      truncated: false,
    });
    assert.doesNotMatch(JSON.stringify(status), /order_SECRET/);
    // the other carrier did not run: nothing recorded for it
    assert.equal(status.carriers.gls.lastReport, null);
    assert.equal(status.carriers.gls.lastRunAt, null);
  });

  it("observe mode follows the configured delivered codes of THAT carrier", () => {
    const s = scheduler(async () => REPORT("gls"));
    assert.equal(s.allapot({} as never).carriers.foxpost.observeMode, true);
    assert.equal(
      s.allapot({ FOXPOST_DELIVERED_STATUS_CODES: "RECEIVE" } as never).carriers
        .foxpost.observeMode,
      false,
    );
    // the other carrier's codes do not count, a list of blanks is no list
    assert.equal(
      s.allapot({ GLS_DELIVERED_STATUS_CODES: "RECEIVE" } as never).carriers
        .foxpost.observeMode,
      true,
    );
    assert.equal(
      s.allapot({ FOXPOST_DELIVERED_STATUS_CODES: " , ," } as never).carriers
        .foxpost.observeMode,
      true,
    );
  });

  it("a failed run is recorded as an error with its code, never its message, and rethrown", async () => {
    const s = scheduler(async () => {
      throw new Error("MEDUSA_NOT_CONFIGURED");
    });
    await assert.rejects(s.runOnce("foxpost"), /MEDUSA_NOT_CONFIGURED/);
    const foxpost = s.allapot({} as never).carriers.foxpost;
    assert.equal(foxpost.lastOutcome, "error");
    assert.equal(foxpost.lastErrorCode, "MEDUSA_NOT_CONFIGURED");
    assert.equal(foxpost.lastReport, null);
    // a message that is not a code (could carry text) is not shown
    const t = scheduler(async () => {
      throw new Error("connect failed to https://host/path?token=secret");
    });
    await assert.rejects(t.runOnce("gls"));
    const gls = t.allapot({} as never).carriers.gls;
    assert.equal(gls.lastErrorCode, "RUN_FAILED");
    assert.doesNotMatch(JSON.stringify(gls), /secret|https/);
  });

  it("a switch that is on with an invalid setting shows its refusal code, not an empty view", () => {
    const s = scheduler(async () => REPORT("gls"));
    const status = s.allapot({
      FOXPOST_STATUS_SYNC_ENABLED: "true",
      FOXPOST_STATUS_SYNC_INTERVAL_MINUTES: "3",
    } as never);
    assert.equal(status.carriers.foxpost.enabled, true);
    assert.equal(
      status.carriers.foxpost.configError,
      "FOXPOST_STATUS_SYNC_INTERVAL_INVALID",
    );
    assert.equal(status.carriers.foxpost.intervalMinutes, null);
    assert.throws(() =>
      parcelStatusSyncConfig(
        {
          FOXPOST_STATUS_SYNC_ENABLED: "true",
          FOXPOST_STATUS_SYNC_INTERVAL_MINUTES: "3",
        } as never,
        "foxpost",
      ),
    );
  });
});
