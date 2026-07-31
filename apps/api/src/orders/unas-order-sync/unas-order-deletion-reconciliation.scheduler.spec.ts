import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  computeReconciliationBackoffMs,
  unasOrderDeletionReconciliationConfig,
  type DeletionReconciliationBatchSummary,
} from "./unas-order-deletion-reconciliation.service.js";
import { UnasOrderDeletionReconciliationScheduler } from "./unas-order-deletion-reconciliation.scheduler.js";
import type { UnasOrderDeletionReconciliationService } from "./unas-order-deletion-reconciliation.service.js";

describe("unasOrderDeletionReconciliationConfig", () => {
  it("is disabled by default with all-zero derived fields (business rule 6: default OFF)", () => {
    assert.deepEqual(unasOrderDeletionReconciliationConfig({}), {
      enabled: false,
      intervalMs: 0,
      startupDelayMs: 0,
      batchSize: 0,
      leaseSeconds: 0,
      recheckIntervalMs: 0,
      baseBackoffMs: 0,
      maxBackoffMs: 0,
    });
  });

  it("applies documented defaults when enabled with no further overrides", () => {
    assert.deepEqual(
      unasOrderDeletionReconciliationConfig({
        UNAS_ORDER_DELETION_RECONCILIATION_ENABLED: "true",
      }),
      {
        enabled: true,
        intervalMs: 1_800_000,
        startupDelayMs: 60_000,
        batchSize: 10,
        leaseSeconds: 120,
        recheckIntervalMs: 86_400_000,
        baseBackoffMs: 60_000,
        maxBackoffMs: 3_600_000,
      },
    );
  });

  it("honors overrides and validates bounds", () => {
    assert.deepEqual(
      unasOrderDeletionReconciliationConfig({
        UNAS_ORDER_DELETION_RECONCILIATION_ENABLED: "true",
        UNAS_ORDER_DELETION_RECONCILIATION_INTERVAL_MINUTES: "5",
        UNAS_ORDER_DELETION_RECONCILIATION_BATCH_SIZE: "3",
        UNAS_ORDER_DELETION_RECONCILIATION_LEASE_SECONDS: "60",
        UNAS_ORDER_DELETION_RECONCILIATION_RECHECK_HOURS: "6",
        UNAS_ORDER_DELETION_RECONCILIATION_BASE_BACKOFF_SECONDS: "10",
        UNAS_ORDER_DELETION_RECONCILIATION_MAX_BACKOFF_MINUTES: "20",
      }),
      {
        enabled: true,
        intervalMs: 300_000,
        startupDelayMs: 60_000,
        batchSize: 3,
        leaseSeconds: 60,
        recheckIntervalMs: 21_600_000,
        baseBackoffMs: 10_000,
        maxBackoffMs: 1_200_000,
      },
    );
    assert.throws(
      () =>
        unasOrderDeletionReconciliationConfig({
          UNAS_ORDER_DELETION_RECONCILIATION_ENABLED: "true",
          UNAS_ORDER_DELETION_RECONCILIATION_BATCH_SIZE: "0",
        }),
      /INVALID_UNAS_ORDER_DELETION_RECONCILIATION_BATCH_SIZE/,
    );
    assert.throws(
      () =>
        unasOrderDeletionReconciliationConfig({
          UNAS_ORDER_DELETION_RECONCILIATION_ENABLED: "true",
          UNAS_ORDER_DELETION_RECONCILIATION_BATCH_SIZE: "101",
        }),
      /INVALID_UNAS_ORDER_DELETION_RECONCILIATION_BATCH_SIZE/,
    );
  });
});

describe("computeReconciliationBackoffMs", () => {
  it("grows exponentially and is capped at maxMs", () => {
    const noJitter = () => 0.5; // midpoint -> multiplier exactly 1
    assert.equal(
      computeReconciliationBackoffMs(1, 60_000, 3_600_000, noJitter),
      60_000,
    );
    assert.equal(
      computeReconciliationBackoffMs(2, 60_000, 3_600_000, noJitter),
      120_000,
    );
    assert.equal(
      computeReconciliationBackoffMs(3, 60_000, 3_600_000, noJitter),
      240_000,
    );
    assert.equal(
      computeReconciliationBackoffMs(20, 60_000, 3_600_000, noJitter),
      3_600_000,
    );
  });
});

describe("UnasOrderDeletionReconciliationScheduler.runOnce", () => {
  it("returns DISABLED without calling the service when the worker is off (default rollout state)", async () => {
    delete process.env.UNAS_ORDER_DELETION_RECONCILIATION_ENABLED;
    let called = false;
    const scheduler = new UnasOrderDeletionReconciliationScheduler({
      processBatch: async () => {
        called = true;
        return {} as DeletionReconciliationBatchSummary;
      },
    } as unknown as UnasOrderDeletionReconciliationService);

    assert.equal(await scheduler.runOnce(), "DISABLED");
    assert.equal(called, false);
  });

  it("delegates to the service and returns its summary when enabled - the same path the manual admin trigger uses", async () => {
    process.env.UNAS_ORDER_DELETION_RECONCILIATION_ENABLED = "true";
    try {
      const summary: DeletionReconciliationBatchSummary = {
        claimed: 2,
        stillExists: 1,
        reconciledDeleted: 1,
        alreadyReconciled: 0,
        transientFailure: 0,
        skippedNoKey: 0,
      };
      const scheduler = new UnasOrderDeletionReconciliationScheduler({
        processBatch: async () => summary,
      } as unknown as UnasOrderDeletionReconciliationService);

      assert.deepEqual(await scheduler.runOnce(), summary);
    } finally {
      delete process.env.UNAS_ORDER_DELETION_RECONCILIATION_ENABLED;
    }
  });

  it("reports FAILED without throwing or leaking error details when the batch itself throws", async () => {
    process.env.UNAS_ORDER_DELETION_RECONCILIATION_ENABLED = "true";
    try {
      const scheduler = new UnasOrderDeletionReconciliationScheduler({
        processBatch: async () => {
          throw new Error("unexpected: leaked detail <script>");
        },
      } as unknown as UnasOrderDeletionReconciliationService);

      assert.equal(await scheduler.runOnce(), "FAILED");
    } finally {
      delete process.env.UNAS_ORDER_DELETION_RECONCILIATION_ENABLED;
    }
  });
});
