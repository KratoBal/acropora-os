import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConflictException } from "@nestjs/common";

import {
  foxpostSettlementScheduleConfig,
  FoxpostSettlementScheduler,
} from "./foxpost-settlement.scheduler.js";
import type { FoxpostSettlementService } from "./foxpost-settlement.service.js";

describe("foxpostSettlementScheduleConfig", () => {
  it("is disabled by default and validates the enabled schedule", () => {
    assert.deepEqual(foxpostSettlementScheduleConfig({}), {
      enabled: false,
      intervalMs: 0,
      startupDelayMs: 0,
    });
    assert.deepEqual(
      foxpostSettlementScheduleConfig({ GMAIL_FOXPOST_SYNC_ENABLED: "true" }),
      { enabled: true, intervalMs: 3_600_000, startupDelayMs: 60_000 },
    );
    assert.throws(
      () =>
        foxpostSettlementScheduleConfig({
          GMAIL_FOXPOST_SYNC_ENABLED: "true",
          GMAIL_FOXPOST_SYNC_INTERVAL_MINUTES: "1",
        }),
      /FOXPOST_SYNC_INTERVAL_INVALID/,
    );
  });
});

describe("FoxpostSettlementScheduler.runOnce", () => {
  it("runs the same sync service as the manual endpoint", async () => {
    let called = false;
    const scheduler = new FoxpostSettlementScheduler({
      sync: async () => {
        called = true;
        return {};
      },
    } as unknown as FoxpostSettlementService);
    assert.equal(await scheduler.runOnce(), "APPLIED");
    assert.equal(called, true);
  });

  it("treats an active run as a safe skip", async () => {
    const scheduler = new FoxpostSettlementScheduler({
      sync: async () => {
        throw new ConflictException("FOXPOST_GMAIL_SYNC_ALREADY_RUNNING");
      },
    } as unknown as FoxpostSettlementService);
    assert.equal(await scheduler.runOnce(), "SKIPPED");
  });
});
