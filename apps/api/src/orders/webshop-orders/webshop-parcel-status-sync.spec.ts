import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { TrackingEvent } from "../../integrations/carriers/carrier.types.js";
import {
  deliveredCodes,
  describeSyncReport,
  syncParcelStatuses,
  type ParcelStatusSyncDeps,
} from "./webshop-parcel-status-sync.js";
import {
  glsStatusSyncConfig,
  parcelStatusSyncConfig,
  WebshopParcelStatusScheduler,
} from "./webshop-parcel-status.scheduler.js";

/*
  WHAT TURNS THIS RED (V0.4). An order moved while NO delivered code is configured (the observe mode must move
  nothing); an order moved from a state the shop does not allow `closed` from (the shop's own rule decides, not
  ours); an already closed order moved again; one parcel's failure stopping the others; the transition sent for a
  parcel that has no delivered event; the delivered code matched on the description instead of the code; the
  scheduler on without the exact switch value; an interval outside its bounds accepted.
*/
const NOW = new Date("2026-11-04T10:00:00Z");
const event = (status: string, statusText = status): TrackingEvent => ({
  status,
  statusText,
  at: null,
});

function fake(
  events: Record<string, TrackingEvent[] | Error>,
  business: Record<string, { status: string; next: string[] } | null> = {},
): ParcelStatusSyncDeps & {
  transitions: [string, string][];
  asked: string[];
  notified: boolean[];
} {
  const transitions: [string, string][] = [];
  const asked: string[] = [];
  const notified: boolean[] = [];
  return {
    transitions,
    asked,
    notified,
    parcelOrderIds: async () => Object.keys(events),
    tracking: async (id) => {
      const value = events[id]!;
      if (value instanceof Error) throw value;
      return value;
    },
    businessStatus: async (id) => {
      asked.push(id);
      const entry = business[id];
      return entry
        ? {
            status: entry.status,
            next_statuses: entry.next.map((status) => ({ status })),
          }
        : null;
    },
    transition: async (id, status, notifyCustomer) => {
      transitions.push([id, status]);
      notified.push(notifyCustomer);
    },
  };
}

describe("deliveredCodes", () => {
  it("reads a comma separated list, trimmed, empty entries dropped; unset is empty", () => {
    assert.deepEqual(
      [
        ...deliveredCodes({ GLS_DELIVERED_STATUS_CODES: " 05, 06 ,,  " }),
      ].sort(),
      ["05", "06"],
    );
    assert.equal(deliveredCodes({}).size, 0);
    assert.equal(deliveredCodes({ GLS_DELIVERED_STATUS_CODES: " , " }).size, 0);
  });
});

describe("syncParcelStatuses", () => {
  const env = { GLS_DELIVERED_STATUS_CODES: "05" };

  it("OBSERVE MODE: with no code configured nothing is moved and the pairs are reported", async () => {
    const deps = fake({
      o1: [event("05", "Delivered"), event("01", "Picked up")],
      o2: [event("05", "Delivered")],
      o3: [event("05", "Delivered")],
    });
    const report = await syncParcelStatuses(deps, {}, NOW);
    assert.deepEqual(deps.transitions, []);
    assert.deepEqual(deps.asked, []);
    assert.equal(report.waiting, 3);
    assert.deepEqual(
      report.observed.map((o) => [o.code, o.description, o.parcels]),
      [
        ["05", "Delivered", 3],
        ["01", "", 1],
      ],
    );
    const text = describeSyncReport(report);
    assert.match(text, /OBSERVE MODE/);
    assert.match(text, /05 "Delivered" \(3\)/);
    assert.match(text, /01 \(1\)/);
  });

  it("a delivered parcel closes an order the shop lets close", async () => {
    const deps = fake(
      { o1: [event("05")] },
      {
        o1: {
          status: "out_for_delivery",
          next: ["closed", "closed_unsuccessfully"],
        },
      },
    );
    const report = await syncParcelStatuses(deps, env, NOW);
    assert.deepEqual(deps.transitions, [["o1", "closed"]]);
    assert.deepEqual(report.closed, ["o1"]);
  });

  it("the shop's own rule decides: no closed among the next statuses means a person decides, nothing is sent", async () => {
    const deps = fake(
      { o1: [event("05")] },
      { o1: { status: "stocking", next: ["out_for_delivery"] } },
    );
    const report = await syncParcelStatuses(deps, env, NOW);
    assert.deepEqual(deps.transitions, []);
    assert.deepEqual(report.skipped, [{ orderId: "o1", status: "stocking" }]);
    assert.match(describeSyncReport(report), /a person decides/);
  });

  it("an already closed order is left alone and counted", async () => {
    const deps = fake(
      { o1: [event("05")] },
      { o1: { status: "closed", next: [] } },
    );
    const report = await syncParcelStatuses(deps, env, NOW);
    assert.deepEqual(deps.transitions, []);
    assert.equal(report.alreadyClosed, 1);
  });

  it("a parcel without a delivered event waits and the shop is not even asked", async () => {
    const deps = fake(
      { o1: [event("01", "Picked up")] },
      { o1: { status: "out_for_delivery", next: ["closed"] } },
    );
    const report = await syncParcelStatuses(deps, env, NOW);
    assert.deepEqual(deps.asked, []);
    assert.deepEqual(deps.transitions, []);
    assert.equal(report.waiting, 1);
  });

  it("the code is matched, not the description: another code never closes, even when its text equals a configured code", async () => {
    const deps = fake(
      {
        o1: [event("07", "Delivered to recipient")],
        o2: [event("99", "05")],
      },
      {
        o1: { status: "out_for_delivery", next: ["closed"] },
        o2: { status: "out_for_delivery", next: ["closed"] },
      },
    );
    await syncParcelStatuses(deps, env, NOW);
    assert.deepEqual(deps.transitions, []);
  });

  it("one parcel's failure does not stop the others, and the report carries codes only", async () => {
    const boom = Object.assign(new Error("secret detail with a name"), {
      code: "REJECTED",
    });
    const deps = fake(
      { o1: boom, o2: [event("05")] },
      { o2: { status: "out_for_delivery", next: ["closed"] } },
    );
    const report = await syncParcelStatuses(deps, env, NOW);
    assert.deepEqual(report.failed, [{ orderId: "o1", error: "REJECTED" }]);
    assert.deepEqual(report.closed, ["o2"]);
    assert.doesNotMatch(JSON.stringify(report), /secret detail/);
    const http = Object.assign(new Error("x"), { status: 502 });
    const again = await syncParcelStatuses(fake({ o3: http }), env, NOW);
    assert.deepEqual(again.failed, [{ orderId: "o3", error: "HTTP_502" }]);
  });

  it("a missing shop status is a failure to look at, not a transition", async () => {
    const deps = fake({ o1: [event("05")] }, { o1: null });
    const report = await syncParcelStatuses(deps, env, NOW);
    assert.deepEqual(report.failed, [{ orderId: "o1", error: "NO_STATUS" }]);
    assert.deepEqual(deps.transitions, []);
  });

  it("asks for the parcels of the last 30 days, at most 200", async () => {
    let asked: { since: Date; limit: number } | null = null;
    const deps = fake({});
    deps.parcelOrderIds = async (since, limit) => {
      asked = { since, limit };
      return [];
    };
    await syncParcelStatuses(deps, env, NOW);
    assert.equal(asked!.limit, 201); // one more than the batch, to know whether it cut something off
    assert.equal(asked!.since.toISOString(), "2026-10-05T10:00:00.000Z");
    assert.equal(
      describeSyncReport(await syncParcelStatuses(deps, env, NOW)),
      "",
    );
  });
});

/*
  THE FOXPOST PARCEL AND THE THANK-YOU MAIL (card ef84489d, acrobot 47552). WHAT TURNS THIS RED: a GLS code closing a
  Foxpost order (or the other way round); the Foxpost run moving an order while its own list is empty; the mail sent
  without the exact switch value, or not sent with it; the report naming the wrong carrier or the wrong variable.
*/
describe("the Foxpost parcel and the mail on closing", () => {
  const closable = { status: "out_for_delivery", next: ["closed"] };

  it("Foxpost has its own delivered codes: the GLS list does not close a Foxpost order, its own does", async () => {
    assert.deepEqual(
      [
        ...deliveredCodes(
          { FOXPOST_DELIVERED_STATUS_CODES: " RECEIVE, HDRECEIVE " },
          "foxpost",
        ),
      ].sort(),
      ["HDRECEIVE", "RECEIVE"],
    );
    assert.equal(
      deliveredCodes({ GLS_DELIVERED_STATUS_CODES: "RECEIVE" }, "foxpost").size,
      0,
    );
    const onlyGls = fake({ o1: [event("RECEIVE")] }, { o1: closable });
    const observed = await syncParcelStatuses(
      onlyGls,
      { GLS_DELIVERED_STATUS_CODES: "RECEIVE" },
      NOW,
      "foxpost",
    );
    assert.deepEqual(
      [onlyGls.transitions, observed.carrier, observed.configuredCodes],
      [[], "foxpost", []],
    );
    const own = fake(
      { o1: [event("CREATE"), event("RECEIVE")] },
      { o1: closable },
    );
    const report = await syncParcelStatuses(
      own,
      { FOXPOST_DELIVERED_STATUS_CODES: "RECEIVE" },
      NOW,
      "foxpost",
    );
    assert.deepEqual(
      [own.transitions, report.closed],
      [[["o1", "closed"]], ["o1"]],
    );
  });

  it("the customer is mailed on closing only when the switch is exactly true", async () => {
    for (const [value, expected] of [
      [undefined, false],
      ["false", false],
      ["1", false],
      ["TRUE", false],
      ["true", true],
    ] as const) {
      const deps = fake({ o1: [event("05")] }, { o1: closable });
      const report = await syncParcelStatuses(
        deps,
        {
          GLS_DELIVERED_STATUS_CODES: "05",
          ...(value === undefined
            ? {}
            : { PARCEL_STATUS_SYNC_NOTIFY_CUSTOMER: value }),
        },
        NOW,
      );
      assert.deepEqual(
        [deps.notified, report.notifyCustomer],
        [[expected], expected],
        String(value),
      );
    }
  });

  it("the report names the carrier and its own variable, and says when the customer was mailed", async () => {
    const foxObserve = await syncParcelStatuses(
      fake({ o1: [event("CREATE")] }),
      {},
      NOW,
      "foxpost",
    );
    const text = describeSyncReport(foxObserve);
    assert.match(text, /^Foxpost status sync: 1 parcels checked/);
    assert.match(text, /OBSERVE MODE: FOXPOST_DELIVERED_STATUS_CODES is empty/);
    const mailed = await syncParcelStatuses(
      fake({ o1: [event("05")] }, { o1: closable }),
      {
        GLS_DELIVERED_STATUS_CODES: "05",
        PARCEL_STATUS_SYNC_NOTIFY_CUSTOMER: "true",
      },
      NOW,
    );
    assert.match(
      describeSyncReport(mailed),
      /^GLS status sync: 1 parcels checked, 1 closed \(the customer mailed\)/,
    );
  });
});

describe("the batch and the observed text", () => {
  const env = { GLS_DELIVERED_STATUS_CODES: "05" };

  it("more parcels than the batch: only the batch is checked, and the report says so", async () => {
    const deps = fake({});
    deps.parcelOrderIds = async () =>
      Array.from({ length: 201 }, (_, i) => `o${i}`);
    let checked = 0;
    deps.tracking = async () => {
      checked += 1;
      return [];
    };
    const report = await syncParcelStatuses(deps, env, NOW);
    assert.equal(checked, 200);
    assert.equal(report.truncated, true);
    assert.match(describeSyncReport(report), /NOT checked/);
  });

  it("exactly the batch is not a cut", async () => {
    const deps = fake({});
    deps.parcelOrderIds = async () =>
      Array.from({ length: 200 }, (_, i) => `o${i}`);
    deps.tracking = async () => [];
    const report = await syncParcelStatuses(deps, env, NOW);
    assert.equal(report.truncated, false);
    assert.doesNotMatch(describeSyncReport(report), /NOT checked/);
  });

  it("a description that carries a name is unique to its parcel: it never reaches the report, short or not", async () => {
    const deps = fake({
      o1: [event("07", "Átvette: Kovács Anna")],
      o2: [event("07", "Átvette: Nagy Béla")],
      o3: [event("07", "Átvette: Kovács Anna Budapest Fő utca 12.")],
    });
    const report = await syncParcelStatuses(deps, {}, NOW);
    const text = JSON.stringify(report) + describeSyncReport(report);
    for (const secret of [
      "Kovács",
      "Nagy",
      "Béla",
      "Anna",
      "Budapest",
      "Fő utca",
    ])
      assert.doesNotMatch(text, new RegExp(secret));
    assert.deepEqual(
      report.observed.map((o) => [o.code, o.description, o.parcels]),
      [["07", "", 3]],
    );
  });

  it("a general description repeated on three different parcels is reported, on two it is not", async () => {
    const three = await syncParcelStatuses(
      fake({
        o1: [event("08", "Kézbesítve")],
        o2: [event("08", "Kézbesítve")],
        o3: [event("08", "Kézbesítve")],
      }),
      {},
      NOW,
    );
    assert.equal(three.observed[0]!.description, "Kézbesítve");
    const two = await syncParcelStatuses(
      fake({
        o1: [event("08", "Kézbesítve")],
        o2: [event("08", "Kézbesítve")],
      }),
      {},
      NOW,
    );
    assert.equal(two.observed[0]!.description, "");
    assert.equal(two.observed[0]!.parcels, 2);
  });

  it("the same parcel repeating a description does not count three times", async () => {
    const report = await syncParcelStatuses(
      fake({
        o1: [event("09", "Név"), event("09", "Név"), event("09", "Név")],
      }),
      {},
      NOW,
    );
    assert.equal(report.observed[0]!.description, "");
  });

  it("a shown description is short and has no control characters (a log line stays one line)", async () => {
    const text =
      "Kézbesítve\nHamis sor\t\u0007 és még egy nagyon hosszú szöveg a végén";
    const ids = {
      o1: [event("08", text)],
      o2: [event("08", text)],
      o3: [event("08", text)],
    };
    const report = await syncParcelStatuses(fake(ids), {}, NOW);
    const description = report.observed[0]!.description;
    assert.ok(description.length > 0 && description.length <= 40, description);
    assert.doesNotMatch(description, /[\u0000-\u001f\u007f]/);
    assert.doesNotMatch(describeSyncReport(report), /^Hamis sor/m);
  });
});

describe("the schedule", () => {
  it("is off unless the switch is exactly true", () => {
    for (const value of [undefined, "", "false", "True", "1", "on"])
      assert.equal(
        glsStatusSyncConfig({ GLS_STATUS_SYNC_ENABLED: value }).enabled,
        false,
        String(value),
      );
    const on = glsStatusSyncConfig({ GLS_STATUS_SYNC_ENABLED: "true" });
    assert.equal(on.enabled, true);
    assert.equal(on.intervalMs, 360 * 60_000);
    assert.equal(on.startupDelayMs, 10 * 60_000);
  });

  it("refuses an interval or delay outside its bounds", () => {
    for (const value of ["5", "1441", "abc", "1.5"])
      assert.throws(
        () =>
          glsStatusSyncConfig({
            GLS_STATUS_SYNC_ENABLED: "true",
            GLS_STATUS_SYNC_INTERVAL_MINUTES: value,
          }),
        /INTERVAL_INVALID/,
      );
    assert.throws(
      () =>
        glsStatusSyncConfig({
          GLS_STATUS_SYNC_ENABLED: "true",
          GLS_STATUS_SYNC_STARTUP_DELAY_MINUTES: "241",
        }),
      /DELAY_INVALID/,
    );
    assert.equal(
      glsStatusSyncConfig({
        GLS_STATUS_SYNC_ENABLED: "true",
        GLS_STATUS_SYNC_INTERVAL_MINUTES: "15",
      }).intervalMs,
      15 * 60_000,
    );
  });

  it("Foxpost has its own switch and timing; the GLS switch does not turn it on", () => {
    assert.equal(
      parcelStatusSyncConfig({ GLS_STATUS_SYNC_ENABLED: "true" }, "foxpost")
        .enabled,
      false,
    );
    const on = parcelStatusSyncConfig(
      {
        FOXPOST_STATUS_SYNC_ENABLED: "true",
        FOXPOST_STATUS_SYNC_INTERVAL_MINUTES: "120",
      },
      "foxpost",
    );
    assert.deepEqual(
      [on.enabled, on.intervalMs, on.startupDelayMs],
      [true, 120 * 60_000, 10 * 60_000],
    );
    assert.throws(
      () =>
        parcelStatusSyncConfig(
          {
            FOXPOST_STATUS_SYNC_ENABLED: "true",
            FOXPOST_STATUS_SYNC_INTERVAL_MINUTES: "5",
          },
          "foxpost",
        ),
      /FOXPOST_STATUS_SYNC_INTERVAL_INVALID/,
    );
  });

  it("each carrier runs on its own: a GLS run still going does not keep the Foxpost run from starting", async () => {
    const carriers: string[] = [];
    let release: () => void = () => undefined;
    const report = (carrier: string) => ({
      carrier,
      checked: 0,
      closed: [],
      alreadyClosed: 0,
      waiting: 0,
      skipped: [],
      failed: [],
      observed: [],
      configuredCodes: [],
      notifyCustomer: false,
      truncated: false,
    });
    const service = {
      run: (_env: unknown, _now: unknown, carrier: string) => {
        carriers.push(carrier);
        return carrier === "gls"
          ? new Promise((resolve) => {
              release = () => resolve(report(carrier));
            })
          : Promise.resolve(report(carrier));
      },
    };
    const scheduler = new WebshopParcelStatusScheduler(service as never);
    const gls = scheduler.runOnce("gls");
    await scheduler.runOnce("foxpost");
    assert.deepEqual(carriers, ["gls", "foxpost"]);
    release();
    await gls;
  });

  it("a run that is still going is not started twice", async () => {
    let calls = 0;
    let release: () => void = () => undefined;
    const empty = {
      checked: 0,
      closed: [],
      alreadyClosed: 0,
      waiting: 0,
      skipped: [],
      failed: [],
      observed: [],
      configuredCodes: [],
      notifyCustomer: false,
      truncated: false,
    };
    const service = {
      run: () => {
        calls += 1;
        // only the first run is slow; a second one (the bug) would finish at once and show in `calls`
        return calls === 1
          ? new Promise((resolve) => {
              release = () => resolve(empty);
            })
          : Promise.resolve(empty);
      },
    };
    const scheduler = new WebshopParcelStatusScheduler(service as never);
    const first = scheduler.runOnce();
    assert.equal(await scheduler.runOnce(), "");
    assert.equal(calls, 1);
    release();
    await first;
  });
});
