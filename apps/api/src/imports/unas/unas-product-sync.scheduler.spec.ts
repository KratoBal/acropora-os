import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { UnasAuthService } from "./unas-auth.service.js";
import {
  unasSyncScheduleConfig,
  UnasProductSyncScheduler,
} from "./unas-product-sync.scheduler.js";
import type { UnasProductSyncService } from "./unas-product-sync.service.js";
import {
  AUTOMATIC_MAX_TO_FALSE,
  type UnasWebshopSellableReconciler,
} from "./unas-webshop-sellable-reconcile.js";

describe("UnasProductSyncScheduler", () => {
  it("is disabled by default and validates enabled intervals", () => {
    assert.deepEqual(unasSyncScheduleConfig({}), {
      enabled: false,
      intervalMs: 0,
      startupDelayMs: 0,
    });
    assert.deepEqual(
      unasSyncScheduleConfig({
        UNAS_PRODUCT_SYNC_ENABLED: "true",
        UNAS_PRODUCT_SYNC_INTERVAL_MINUTES: "20",
        UNAS_PRODUCT_SYNC_STARTUP_DELAY_SECONDS: "5",
      }),
      { enabled: true, intervalMs: 1_200_000, startupDelayMs: 5000 },
    );
    assert.throws(
      () =>
        unasSyncScheduleConfig({
          UNAS_PRODUCT_SYNC_ENABLED: "true",
          UNAS_PRODUCT_SYNC_INTERVAL_MINUTES: "1",
        }),
      /INVALID_UNAS_PRODUCT_SYNC_INTERVAL_MINUTES/,
    );
  });

  it("runs with a server-side token and returns a safe outcome", async () => {
    let receivedToken = "";
    const scheduler = new UnasProductSyncScheduler(
      { getToken: async () => "internal-token" } as UnasAuthService,
      {
        runIncremental: async (token: string) => {
          receivedToken = token;
          return {};
        },
      } as unknown as UnasProductSyncService,
      {
        run: async () => ({ mode: "applied", toTrue: 0, toFalse: 0 }),
      } as unknown as UnasWebshopSellableReconciler,
    );

    assert.equal(await scheduler.runOnce(), "APPLIED");
    assert.equal(receivedToken, "internal-token");
  });

  /**
   * THE RECOMPUTE RUNS AFTER A GOOD SYNC, WITH THE CAP, AND NEVER TURNS A GOOD RUN RED (card e1de003d).
   * What must fail: no reconcile after the sync (the stored value stays behind the rule); the scheduled
   * run asking with no cap (a broken reader could un-publish the shop); a reconcile error failing the run;
   * a reconcile on a FAILED sync.
   */
  it("reconciles the stored sellable value after a successful sync, with the scheduled cap", async () => {
    const order: string[] = [];
    let asked: { apply: boolean; maxToFalse?: number } | undefined;
    const scheduler = new UnasProductSyncScheduler(
      { getToken: async () => "t" } as UnasAuthService,
      {
        runIncremental: async () => (order.push("sync"), {}),
      } as unknown as UnasProductSyncService,
      {
        run: async (options: { apply: boolean; maxToFalse?: number }) => {
          order.push("reconcile");
          asked = options;
          return {
            mode: "applied",
            toTrue: 1,
            toFalse: 0,
            skippedNoBaseStatus: 0,
          };
        },
      } as unknown as UnasWebshopSellableReconciler,
    );
    assert.equal(await scheduler.runOnce(), "APPLIED");
    assert.deepEqual(order, ["sync", "reconcile"]);
    assert.deepEqual(asked, {
      apply: true,
      maxToFalse: AUTOMATIC_MAX_TO_FALSE,
    });
  });

  it("a reconcile error does not fail the run, and a failed sync does not reconcile", async () => {
    let reconciled = 0;
    const throwing = {
      run: async () => (reconciled++, Promise.reject(new Error("boom"))),
    } as unknown as UnasWebshopSellableReconciler;
    const good = new UnasProductSyncScheduler(
      { getToken: async () => "t" } as UnasAuthService,
      { runIncremental: async () => ({}) } as unknown as UnasProductSyncService,
      throwing,
    );
    assert.equal(await good.runOnce(), "APPLIED");
    assert.equal(reconciled, 1);

    const failed = new UnasProductSyncScheduler(
      { getToken: async () => "t" } as UnasAuthService,
      {
        runIncremental: async () => Promise.reject(new Error("UNAS_DOWN")),
      } as unknown as UnasProductSyncService,
      throwing,
    );
    assert.equal(await failed.runOnce(), "FAILED");
    assert.equal(reconciled, 1);
  });
});
