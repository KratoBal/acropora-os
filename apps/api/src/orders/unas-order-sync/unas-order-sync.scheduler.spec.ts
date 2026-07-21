import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConflictException } from "@nestjs/common";

import type { UnasAuthService } from "../../imports/unas/unas-auth.service.js";
import {
  unasOrderSyncScheduleConfig,
  UnasOrderSyncScheduler,
} from "./unas-order-sync.scheduler.js";
import type { UnasOrderSyncService } from "./unas-order-sync.service.js";

describe("unasOrderSyncScheduleConfig", () => {
  it("is disabled by default, defaults to a 5-minute interval, and validates bounds", () => {
    assert.deepEqual(unasOrderSyncScheduleConfig({}), {
      enabled: false,
      intervalMs: 0,
      startupDelayMs: 0,
    });
    assert.deepEqual(
      unasOrderSyncScheduleConfig({ UNAS_ORDER_SYNC_ENABLED: "true" }),
      { enabled: true, intervalMs: 300_000, startupDelayMs: 30_000 },
    );
    assert.deepEqual(
      unasOrderSyncScheduleConfig({
        UNAS_ORDER_SYNC_ENABLED: "true",
        UNAS_ORDER_SYNC_INTERVAL_MINUTES: "10",
        UNAS_ORDER_SYNC_STARTUP_DELAY_SECONDS: "5",
      }),
      { enabled: true, intervalMs: 600_000, startupDelayMs: 5000 },
    );
    assert.throws(
      () =>
        unasOrderSyncScheduleConfig({
          UNAS_ORDER_SYNC_ENABLED: "true",
          UNAS_ORDER_SYNC_INTERVAL_MINUTES: "0",
        }),
      /INVALID_UNAS_ORDER_SYNC_INTERVAL_MINUTES/,
    );
  });
});

describe("UnasOrderSyncScheduler.runOnce", () => {
  it("runs with a server-side token and returns APPLIED", async () => {
    let receivedToken = "";
    const scheduler = new UnasOrderSyncScheduler(
      { getToken: async () => "internal-token" } as UnasAuthService,
      {
        runIncremental: async (token: string) => {
          receivedToken = token;
          return {};
        },
      } as unknown as UnasOrderSyncService,
    );

    assert.equal(await scheduler.runOnce(), "APPLIED");
    assert.equal(receivedToken, "internal-token");
  });

  it("treats an already-running sync as a safe skip, not a failure", async () => {
    const scheduler = new UnasOrderSyncScheduler(
      { getToken: async () => "token" } as UnasAuthService,
      {
        runIncremental: async () => {
          throw new ConflictException("UNAS_ORDER_SYNC_ALREADY_RUNNING");
        },
      } as unknown as UnasOrderSyncService,
    );

    assert.equal(await scheduler.runOnce(), "SKIPPED");
  });

  it("reports other failures without leaking error details", async () => {
    const scheduler = new UnasOrderSyncScheduler(
      { getToken: async () => "token" } as UnasAuthService,
      {
        runIncremental: async () => {
          throw new Error("something unexpected happened: <script>");
        },
      } as unknown as UnasOrderSyncService,
    );

    assert.equal(await scheduler.runOnce(), "FAILED");
  });
});
