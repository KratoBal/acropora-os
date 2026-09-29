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

  it("reads the switch patiently: case and surrounding space do not turn it off", () => {
    // production 2026-09-29: the variable was set and the scheduler never ran
    for (const value of ["true", "True", "TRUE", " true", "true\n"])
      assert.equal(
        foxpostSettlementScheduleConfig({ GMAIL_FOXPOST_SYNC_ENABLED: value })
          .enabled,
        true,
        JSON.stringify(value),
      );
    for (const value of ["", "false", "1", "yes", "truee"])
      assert.equal(
        foxpostSettlementScheduleConfig({ GMAIL_FOXPOST_SYNC_ENABLED: value })
          .enabled,
        false,
        JSON.stringify(value),
      );
  });
});

describe("FoxpostSettlementScheduler.onModuleInit", () => {
  function startedWith(value: string | undefined): string[] {
    const saved = process.env.GMAIL_FOXPOST_SYNC_ENABLED;
    if (value === undefined) delete process.env.GMAIL_FOXPOST_SYNC_ENABLED;
    else process.env.GMAIL_FOXPOST_SYNC_ENABLED = value;
    const logged: string[] = [];
    const scheduler = new FoxpostSettlementScheduler(
      {} as FoxpostSettlementService,
    );
    (
      scheduler as unknown as { logger: { log(message: string): void } }
    ).logger = { log: (message: string) => logged.push(message) };
    try {
      scheduler.onModuleInit();
    } finally {
      scheduler.onModuleDestroy();
      if (saved === undefined) delete process.env.GMAIL_FOXPOST_SYNC_ENABLED;
      else process.env.GMAIL_FOXPOST_SYNC_ENABLED = saved;
    }
    return logged;
  }

  it("says in one log line that it is off, and why", () => {
    assert.deepEqual(startedWith(undefined), [
      "Foxpost Gmail scheduler disabled (GMAIL_FOXPOST_SYNC_ENABLED is not set)",
    ]);
    assert.deepEqual(startedWith("1"), [
      "Foxpost Gmail scheduler disabled (GMAIL_FOXPOST_SYNC_ENABLED is set, but not true)",
    ]);
  });

  it("says that it is on", () => {
    assert.deepEqual(startedWith("True"), [
      "Foxpost Gmail scheduler enabled (60 min)",
    ]);
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
