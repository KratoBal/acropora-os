import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { UnasAuthService } from "./unas-auth.service.js";
import {
  unasSyncScheduleConfig,
  UnasProductSyncScheduler,
} from "./unas-product-sync.scheduler.js";
import type { UnasProductSyncService } from "./unas-product-sync.service.js";

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
    );

    assert.equal(await scheduler.runOnce(), "APPLIED");
    assert.equal(receivedToken, "internal-token");
  });
});
