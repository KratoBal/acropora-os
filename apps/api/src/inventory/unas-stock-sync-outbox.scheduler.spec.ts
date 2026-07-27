import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  unasStockSyncWorkerConfig,
  type ProcessBatchSummary,
} from "./unas-stock-sync-outbox.service.js";
import { UnasStockSyncOutboxScheduler } from "./unas-stock-sync-outbox.scheduler.js";
import type { UnasStockSyncOutboxService } from "./unas-stock-sync-outbox.service.js";

describe("unasStockSyncWorkerConfig", () => {
  it("is disabled by default with all-zero derived fields", () => {
    assert.deepEqual(unasStockSyncWorkerConfig({}), {
      enabled: false,
      intervalMs: 0,
      startupDelayMs: 0,
      batchSize: 0,
      leaseSeconds: 0,
      maxAttempts: 0,
      baseBackoffMs: 0,
      maxBackoffMs: 0,
    });
  });

  it("applies documented defaults when enabled with no further overrides", () => {
    assert.deepEqual(
      unasStockSyncWorkerConfig({ UNAS_STOCK_SYNC_WORKER_ENABLED: "true" }),
      {
        enabled: true,
        intervalMs: 15_000,
        startupDelayMs: 30_000,
        batchSize: 20,
        leaseSeconds: 120,
        maxAttempts: 8,
        baseBackoffMs: 30_000,
        maxBackoffMs: 1_800_000,
      },
    );
  });

  it("honors overrides and validates bounds", () => {
    assert.deepEqual(
      unasStockSyncWorkerConfig({
        UNAS_STOCK_SYNC_WORKER_ENABLED: "true",
        UNAS_STOCK_SYNC_WORKER_INTERVAL_SECONDS: "5",
        UNAS_STOCK_SYNC_WORKER_BATCH_SIZE: "50",
        UNAS_STOCK_SYNC_WORKER_LEASE_SECONDS: "60",
        UNAS_STOCK_SYNC_WORKER_MAX_ATTEMPTS: "4",
        UNAS_STOCK_SYNC_WORKER_BASE_BACKOFF_SECONDS: "10",
        UNAS_STOCK_SYNC_WORKER_MAX_BACKOFF_SECONDS: "100",
      }),
      {
        enabled: true,
        intervalMs: 5000,
        startupDelayMs: 30_000,
        batchSize: 50,
        leaseSeconds: 60,
        maxAttempts: 4,
        baseBackoffMs: 10_000,
        maxBackoffMs: 100_000,
      },
    );
    assert.throws(
      () =>
        unasStockSyncWorkerConfig({
          UNAS_STOCK_SYNC_WORKER_ENABLED: "true",
          UNAS_STOCK_SYNC_WORKER_BATCH_SIZE: "0",
        }),
      /INVALID_UNAS_STOCK_SYNC_WORKER_BATCH_SIZE/,
    );
    assert.throws(
      () =>
        unasStockSyncWorkerConfig({
          UNAS_STOCK_SYNC_WORKER_ENABLED: "true",
          UNAS_STOCK_SYNC_WORKER_MAX_BACKOFF_SECONDS: "5",
          UNAS_STOCK_SYNC_WORKER_BASE_BACKOFF_SECONDS: "30",
        }),
      /INVALID_UNAS_STOCK_SYNC_WORKER_MAX_BACKOFF_SECONDS/,
    );
  });
});

describe("UnasStockSyncOutboxScheduler.runOnce", () => {
  it("returns DISABLED without calling the service when the worker is off", async () => {
    delete process.env.UNAS_STOCK_SYNC_WORKER_ENABLED;
    let called = false;
    const scheduler = new UnasStockSyncOutboxScheduler({
      processBatch: async () => {
        called = true;
        return {} as ProcessBatchSummary;
      },
    } as unknown as UnasStockSyncOutboxService);

    assert.equal(await scheduler.runOnce(), "DISABLED");
    assert.equal(called, false);
  });

  it("delegates to the service and returns its summary when enabled", async () => {
    process.env.UNAS_STOCK_SYNC_WORKER_ENABLED = "true";
    try {
      const summary: ProcessBatchSummary = {
        claimed: 2,
        succeeded: 2,
        superseded: 0,
        retried: 0,
        deadLettered: 0,
      };
      const scheduler = new UnasStockSyncOutboxScheduler({
        processBatch: async () => summary,
      } as unknown as UnasStockSyncOutboxService);

      assert.deepEqual(await scheduler.runOnce(), summary);
    } finally {
      delete process.env.UNAS_STOCK_SYNC_WORKER_ENABLED;
    }
  });

  it("reports FAILED without throwing or leaking error details when the batch itself throws", async () => {
    process.env.UNAS_STOCK_SYNC_WORKER_ENABLED = "true";
    try {
      const scheduler = new UnasStockSyncOutboxScheduler({
        processBatch: async () => {
          throw new Error("unexpected: leaked detail <script>");
        },
      } as unknown as UnasStockSyncOutboxService);

      assert.equal(await scheduler.runOnce(), "FAILED");
    } finally {
      delete process.env.UNAS_STOCK_SYNC_WORKER_ENABLED;
    }
  });
});
