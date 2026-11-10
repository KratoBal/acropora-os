import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ReefClubRateLimits } from "./reefclub-rate-limits.js";
import { ReefClubRunOutController } from "./reefclub-runout.controller.js";
import { REEFCLUB_PUBLIC_KEY, type ReefClubRequest } from "./reefclub.guard.js";

/*
  THE RUN-OUT REMINDER'S ROUTES (ReefClub V3.2, slice 3b). WHAT TURNS THIS RED: the account taken from anywhere but the session; a
  named refusal of the service answered as a success, or without its code; a missing product answered as anything but a 404 with
  its code; the unsubscribe needing a session, or a wrong key answered as a success; a turn-off of a reminder that is not on anything but the one 404; the unsubscribe
  or the turn-on without its limit; the turn-off or the turn-on public.
*/
const request = (account = "a1"): ReefClubRequest => ({
  headers: { "x-forwarded-for": "203.0.113.7" },
  reefClubAccountId: account,
});

function setup(service: Record<string, unknown>) {
  const calls: unknown[][] = [];
  const recorded = new Proxy(service, {
    get: (target, name) => {
      const value = target[name as string];
      return typeof value === "function"
        ? (...args: unknown[]) => {
            calls.push([name, ...args]);
            return value(...args);
          }
        : value;
    },
  });
  const limits = new ReefClubRateLimits();
  const controller = new ReefClubRunOutController(recorded as never, limits);
  return { controller, calls, limits };
}

async function statusOf(promise: Promise<unknown>) {
  try {
    await promise;
    return { status: 200, body: null };
  } catch (error) {
    const e = error as {
      getStatus?: () => number;
      getResponse?: () => unknown;
    };
    if (!e.getStatus) throw error;
    return { status: e.getStatus(), body: e.getResponse?.() as any };
  }
}

describe("the run-out reminder routes", () => {
  it("the overview is the locks' state and the session account's reminders", async () => {
    const { controller, calls } = setup({
      status: () => ({ state: "no-text", text: null, version: null }),
      list: async () => [],
      products: async () => [],
    });
    assert.deepEqual(await controller.overview(request("a7")), {
      state: "no-text",
      text: null,
      version: null,
      reminders: [],
      products: [],
    });
    assert.deepEqual(calls.map((c) => c[0]).sort(), [
      "list",
      "products",
      "status",
    ]);
    assert.deepEqual(
      calls.find((c) => c[0] === "list"),
      ["list", "a7"],
    );
  });

  it("turning on takes the account from the session, and every named refusal keeps its code: a missing product is the 404", async () => {
    let answer: unknown = { outcome: "ENABLED", id: "r1" };
    const { controller, calls } = setup({ enable: async () => answer });
    const body = { productId: "p1", aquariumId: "q1", consentVersion: "v1" };
    assert.deepEqual(await controller.enable(request("a7"), body), {
      id: "r1",
    });
    assert.deepEqual(calls[0], ["enable", "a7", body]);
    for (const [code, status] of [
      ["FEATURE_OFF", 400],
      ["CONSENT_TEXT_MISSING", 400],
      ["UNSUBSCRIBE_SECRET_MISSING", 400],
      ["CONSENT_VERSION_CHANGED", 400],
      ["NO_VOLUME", 400],
      ["PRODUCT_NOT_FOUND", 404],
    ] as const) {
      answer = { outcome: "REFUSED", code, message: `uzenet ${code}` };
      const r = await statusOf(controller.enable(request(), body));
      assert.equal(r.status, status, code);
      assert.deepEqual(r.body, { message: `uzenet ${code}`, code }, code);
    }
  });

  it("turning off is a 204, and no active reminder of the product (a second time, or another member's) the one 404", async () => {
    const outcomes = [{ outcome: "DISABLED" }, { outcome: "NOT_ACTIVE" }];
    const { controller, calls } = setup({
      disable: async () => outcomes.shift(),
    });
    assert.equal(await controller.disable(request("a7"), "p1"), undefined);
    const second = await statusOf(controller.disable(request("a7"), "p1"));
    assert.equal(second.status, 404);
    assert.equal(
      second.body.code,
      undefined,
      "the one 404, no code of its own",
    );
    assert.deepEqual(calls[0], ["disable", "a7", "p1"]);
  });

  it("the unsubscribe is the one public route: a wrong key is a 404 with its code, a second click a success", async () => {
    const proto = ReefClubRunOutController.prototype;
    const isPublic = (name: keyof typeof proto) =>
      Reflect.getMetadata(REEFCLUB_PUBLIC_KEY, proto[name]) === true;
    assert.equal(isPublic("unsubscribe"), true);
    for (const name of ["overview", "enable", "disable"] as const)
      assert.equal(isPublic(name), false, name);

    const outcomes = [
      { outcome: "UNSUBSCRIBED" },
      { outcome: "ALREADY_UNSUBSCRIBED" },
      { outcome: "UNKNOWN_KEY" },
    ];
    const { controller, calls } = setup({
      unsubscribeByKey: async () => outcomes.shift(),
    });
    const anonymous: ReefClubRequest = { headers: {} };
    assert.deepEqual(await controller.unsubscribe(anonymous, { key: "k" }), {
      outcome: "UNSUBSCRIBED",
    });
    assert.deepEqual(await controller.unsubscribe(anonymous, { key: "k" }), {
      outcome: "ALREADY_UNSUBSCRIBED",
    });
    const wrong = await statusOf(
      controller.unsubscribe(anonymous, { key: "rossz" }),
    );
    assert.equal(wrong.status, 404);
    assert.equal(wrong.body.code, "UNKNOWN_KEY");
    assert.deepEqual(calls[0], ["unsubscribeByKey", "k"]);
  });

  it("the turn-on is limited per account and the unsubscribe per address", async () => {
    const { controller, limits } = setup({
      enable: async () => ({ outcome: "ENABLED", id: "r1" }),
      unsubscribeByKey: async () => ({ outcome: "UNSUBSCRIBED" }),
    });
    const body = { productId: "p1", aquariumId: "q1", consentVersion: "v1" };
    for (let i = 0; i < 60; i += 1) await controller.enable(request(), body);
    assert.equal(
      (await statusOf(controller.enable(request(), body))).status,
      429,
    );
    // another account is not limited by the first one
    await controller.enable(request("a2"), body);
    for (let i = 0; i < 30; i += 1)
      await controller.unsubscribe(request(), { key: "k" });
    assert.equal(
      (await statusOf(controller.unsubscribe(request(), { key: "k" }))).status,
      429,
    );
    assert.ok(limits.runOutUnsubscribeByAddress);
  });
});
