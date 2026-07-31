import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { UnasApiOrder } from "@acropora/types";

import { UnasApiError } from "../../imports/unas/unas-api.client.js";
import type { UnasApiClient } from "../../imports/unas/unas-api.client.js";
import type { UnasAuthService } from "../../imports/unas/unas-auth.service.js";
import type {
  ClaimedDeletionCandidate,
  UnasOrderDeletionReconciliationRepository,
} from "./unas-order-deletion-reconciliation.repository.js";
import {
  UnasOrderDeletionReconciliationService,
  unasOrderDeletionReconciliationConfig,
  type UnasOrderDeletionReconciliationConfig,
} from "./unas-order-deletion-reconciliation.service.js";
import type { UnasOrderSyncRepository } from "./unas-order-sync.repository.js";

function candidate(
  overrides: Partial<ClaimedDeletionCandidate> = {},
): ClaimedDeletionCandidate {
  return { id: "order-1", unasKey: "UN-1", attempts: 1, ...overrides };
}

function config(
  overrides: Partial<UnasOrderDeletionReconciliationConfig> = {},
): UnasOrderDeletionReconciliationConfig {
  return {
    ...unasOrderDeletionReconciliationConfig({
      UNAS_ORDER_DELETION_RECONCILIATION_ENABLED: "true",
    }),
    ...overrides,
  };
}

interface RepoCalls {
  claimBatchArgs: unknown[];
  releaseAfterCheckArgs: Array<{ orderId: string; nextCheckDelayMs: number }>;
  clearAfterDeletionIds: string[];
  skipUnresolvableArgs: Array<{ orderId: string; nextCheckDelayMs: number }>;
}

function buildFakeCandidates(options: {
  claimed: ClaimedDeletionCandidate[];
}) {
  const calls: RepoCalls = {
    claimBatchArgs: [],
    releaseAfterCheckArgs: [],
    clearAfterDeletionIds: [],
    skipUnresolvableArgs: [],
  };
  const candidates = {
    claimBatch: async (args: unknown) => {
      calls.claimBatchArgs.push(args);
      return options.claimed;
    },
    releaseAfterCheck: async (args: {
      orderId: string;
      nextCheckDelayMs: number;
    }) => {
      calls.releaseAfterCheckArgs.push(args);
    },
    clearAfterDeletion: async (orderId: string) => {
      calls.clearAfterDeletionIds.push(orderId);
    },
    skipUnresolvable: async (args: {
      orderId: string;
      nextCheckDelayMs: number;
    }) => {
      calls.skipUnresolvableArgs.push(args);
    },
  } as unknown as UnasOrderDeletionReconciliationRepository;
  return { candidates, calls };
}

function buildService(params: {
  claimed: ClaimedDeletionCandidate[];
  getOrderByKey?: (key: string) => Promise<UnasApiOrder | null>;
  reconcileDeletedOrder?: (
    orderId: string,
    unasKey: string,
  ) => Promise<{ reversed: boolean; alreadyReconciled: boolean }>;
}) {
  const { candidates, calls } = buildFakeCandidates({ claimed: params.claimed });
  const getOrderByKeyCalls: string[] = [];
  const api = {
    getOrderByKey: async (_token: string, key: string) => {
      getOrderByKeyCalls.push(key);
      if (params.getOrderByKey) return params.getOrderByKey(key);
      return null;
    },
  } as unknown as UnasApiClient;
  let authCallCount = 0;
  const auth = {
    getToken: async () => {
      authCallCount += 1;
      return "token";
    },
  } as unknown as UnasAuthService;
  const reconcileDeletedOrderCalls: Array<{
    orderId: string;
    unasKey: string;
  }> = [];
  const orderSync = {
    reconcileDeletedOrder: async (orderId: string, unasKey: string) => {
      reconcileDeletedOrderCalls.push({ orderId, unasKey });
      if (params.reconcileDeletedOrder)
        return params.reconcileDeletedOrder(orderId, unasKey);
      return { reversed: true, alreadyReconciled: false };
    },
  } as unknown as UnasOrderSyncRepository;
  const service = new UnasOrderDeletionReconciliationService(
    candidates,
    orderSync,
    api,
    auth,
  );
  return {
    service,
    calls,
    getOrderByKeyCalls,
    reconcileDeletedOrderCalls,
    getAuthCallCount: () => authCallCount,
  };
}

describe("UnasOrderDeletionReconciliationService.processBatch", () => {
  it("returns an all-zero summary without calling UNAS when nothing is claimed", async () => {
    const { service, getOrderByKeyCalls } = buildService({ claimed: [] });

    const summary = await service.processBatch(config());

    assert.equal(summary.claimed, 0);
    assert.equal(getOrderByKeyCalls.length, 0);
  });

  it("skips a candidate with no resolvable UNAS Key without burning a UNAS call (defensive-only path)", async () => {
    const { service, calls, getOrderByKeyCalls, getAuthCallCount } =
      buildService({ claimed: [candidate({ unasKey: null })] });

    const summary = await service.processBatch(config());

    assert.equal(summary.skippedNoKey, 1);
    assert.equal(getOrderByKeyCalls.length, 0);
    assert.equal(getAuthCallCount(), 0);
    assert.equal(calls.skipUnresolvableArgs.length, 1);
    assert.equal(calls.skipUnresolvableArgs[0]?.orderId, "order-1");
  });

  it("releases and reschedules a still-existing order without touching status/stock (worker only checks existence)", async () => {
    const order = { key: "UN-1" } as UnasApiOrder;
    const { service, calls, reconcileDeletedOrderCalls } = buildService({
      claimed: [candidate()],
      getOrderByKey: async () => order,
    });

    const summary = await service.processBatch(config());

    assert.equal(summary.stillExists, 1);
    assert.equal(reconcileDeletedOrderCalls.length, 0);
    assert.equal(calls.releaseAfterCheckArgs.length, 1);
    assert.equal(
      calls.releaseAfterCheckArgs[0]?.nextCheckDelayMs,
      config().recheckIntervalMs,
    );
  });

  it("reconciles a confirmed NOT_FOUND through the exact same shared reconciliation core the manual refresh uses", async () => {
    const { service, calls, reconcileDeletedOrderCalls } = buildService({
      claimed: [candidate()],
      getOrderByKey: async () => null,
    });

    const summary = await service.processBatch(config());

    assert.equal(summary.reconciledDeleted, 1);
    assert.deepEqual(reconcileDeletedOrderCalls, [
      { orderId: "order-1", unasKey: "UN-1" },
    ]);
    assert.deepEqual(calls.clearAfterDeletionIds, ["order-1"]);
  });

  it("counts an already-reconciled outcome separately from a fresh reconciliation (idempotency surfaced, not double-counted)", async () => {
    const { service } = buildService({
      claimed: [candidate()],
      getOrderByKey: async () => null,
      reconcileDeletedOrder: async () => ({
        reversed: false,
        alreadyReconciled: true,
      }),
    });

    const summary = await service.processBatch(config());

    assert.equal(summary.alreadyReconciled, 1);
    assert.equal(summary.reconciledDeleted, 0);
  });

  it("never treats a transient UnasApiError as a deletion - reschedules with backoff, touches no order/stock state (#11)", async () => {
    const { service, calls, reconcileDeletedOrderCalls } = buildService({
      claimed: [candidate({ attempts: 2 })],
      getOrderByKey: async () => {
        throw new UnasApiError("HTTP_5XX");
      },
    });

    const summary = await service.processBatch(config());

    assert.equal(summary.transientFailure, 1);
    assert.equal(reconcileDeletedOrderCalls.length, 0);
    assert.equal(calls.releaseAfterCheckArgs.length, 1);
    assert.ok(calls.releaseAfterCheckArgs[0]!.nextCheckDelayMs > 0);
  });

  it("classifies an unexpected (non-UnasApiError) failure as transient too, never as a deletion", async () => {
    const { service, calls, reconcileDeletedOrderCalls } = buildService({
      claimed: [candidate()],
      getOrderByKey: async () => {
        throw new Error("boom");
      },
    });

    const summary = await service.processBatch(config());

    assert.equal(summary.transientFailure, 1);
    assert.equal(reconcileDeletedOrderCalls.length, 0);
    assert.equal(calls.releaseAfterCheckArgs.length, 1);
  });

  it("processes a batch of multiple claimed rows independently (batching)", async () => {
    const responses = new Map<string, UnasApiOrder | null>([
      ["UN-1", { key: "UN-1" } as UnasApiOrder],
      ["UN-2", null],
    ]);
    const { service } = buildService({
      claimed: [
        candidate({ id: "order-1", unasKey: "UN-1" }),
        candidate({ id: "order-2", unasKey: "UN-2" }),
      ],
      getOrderByKey: async (key) => responses.get(key) ?? null,
    });

    const summary = await service.processBatch(config());

    assert.equal(summary.claimed, 2);
    assert.equal(summary.stillExists, 1);
    assert.equal(summary.reconciledDeleted, 1);
  });

  it("reuses a single fetched auth token across every row in the batch (lease/batch efficiency)", async () => {
    const { service, getAuthCallCount } = buildService({
      claimed: [
        candidate({ id: "order-1", unasKey: "UN-1" }),
        candidate({ id: "order-2", unasKey: "UN-2" }),
        candidate({ id: "order-3", unasKey: "UN-3" }),
      ],
    });

    await service.processBatch(config());

    assert.equal(
      getAuthCallCount(),
      1,
      "must fetch the UNAS token at most once per batch, not once per row",
    );
  });

  it("passes the configured batchSize/leaseSeconds through to claimBatch", async () => {
    const { service, calls } = buildService({ claimed: [] });

    await service.processBatch(config({ batchSize: 7, leaseSeconds: 45 }));

    assert.equal(
      (calls.claimBatchArgs[0] as { batchSize: number }).batchSize,
      7,
    );
    assert.equal(
      (calls.claimBatchArgs[0] as { leaseSeconds: number }).leaseSeconds,
      45,
    );
  });
});
