import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@acropora/database";

import { UnasApiError } from "../imports/unas/unas-api.client.js";
import type { UnasApiClient } from "../imports/unas/unas-api.client.js";
import type { UnasAuthService } from "../imports/unas/unas-auth.service.js";
import type {
  ClaimedUnasStockSyncOutboxRow,
  UnasStockSyncOutboxRepository,
} from "./unas-stock-sync-outbox.repository.js";
import {
  computeNextAttemptDelayMs,
  UnasStockSyncOutboxService,
  type StockLookupDatabase,
  type UnasStockSyncWorkerConfig,
} from "./unas-stock-sync-outbox.service.js";

function row(
  overrides: Partial<ClaimedUnasStockSyncOutboxRow> = {},
): ClaimedUnasStockSyncOutboxRow {
  return {
    id: "outbox-1",
    variantId: "variant-1",
    warehouseId: "warehouse-1",
    sku: "SKU-1",
    targetOnHand: new Prisma.Decimal("5"),
    idempotencyKey: "POS_SALE:ORDER-1:variant-1",
    sourceProcess: "POS_SALE",
    sourceRecordId: "order-1",
    attempts: 1,
    sequence: 1n,
    ...overrides,
  };
}

function config(
  overrides: Partial<UnasStockSyncWorkerConfig> = {},
): UnasStockSyncWorkerConfig {
  return {
    enabled: true,
    intervalMs: 15_000,
    startupDelayMs: 30_000,
    batchSize: 20,
    leaseSeconds: 120,
    maxAttempts: 3,
    baseBackoffMs: 1000,
    maxBackoffMs: 10_000,
    ...overrides,
  };
}

interface RepoCalls {
  claimBatchArgs: unknown[];
  isSupersededArgs: unknown[];
  markSucceededIds: string[];
  markSupersededSuccessArgs: Array<{ id: string; by: string }>;
  markPackageProductSuccessIds: string[];
  markFailedForRetryArgs: unknown[];
  markDeadLetterArgs: unknown[];
}

function buildFakeRepository(options: {
  claimed: ClaimedUnasStockSyncOutboxRow[];
  isSuperseded?: (
    row: ClaimedUnasStockSyncOutboxRow,
  ) => { supersededByOutboxId: string } | null;
}) {
  const calls: RepoCalls = {
    claimBatchArgs: [],
    isSupersededArgs: [],
    markSucceededIds: [],
    markSupersededSuccessArgs: [],
    markPackageProductSuccessIds: [],
    markFailedForRetryArgs: [],
    markDeadLetterArgs: [],
  };
  const repository = {
    claimBatch: async (args: unknown) => {
      calls.claimBatchArgs.push(args);
      return options.claimed;
    },
    isSuperseded: async (args: { id: string }) => {
      calls.isSupersededArgs.push(args);
      const found = options.claimed.find((item) => item.id === args.id);
      return found && options.isSuperseded ? options.isSuperseded(found) : null;
    },
    markSucceeded: async (id: string) => {
      calls.markSucceededIds.push(id);
    },
    markSupersededSuccess: async (id: string, by: string) => {
      calls.markSupersededSuccessArgs.push({ id, by });
    },
    markPackageProductSuccess: async (id: string) => {
      calls.markPackageProductSuccessIds.push(id);
    },
    markFailedForRetry: async (args: unknown) => {
      calls.markFailedForRetryArgs.push(args);
    },
    markDeadLetter: async (args: unknown) => {
      calls.markDeadLetterArgs.push(args);
    },
  } as unknown as UnasStockSyncOutboxRepository;
  return { repository, calls };
}

function buildFakeStockLookup(
  onHandByVariant: Map<string, Prisma.Decimal>,
  reservedByVariant: Map<string, Prisma.Decimal> = new Map(),
  packageVariantIds: Set<string> = new Set(),
): StockLookupDatabase {
  return {
    productVariant: {
      findUnique: async (args: unknown) => {
        const variantId = (args as { where: { id: string } }).where.id;
        return {
          product: {
            unasSnapshot: {
              isPackageProduct: packageVariantIds.has(variantId),
            },
          },
        };
      },
    },
    stockItem: {
      findFirst: async (args: unknown) => {
        const variantId = (args as { where: { variantId: string } }).where
          .variantId;
        const onHand = onHandByVariant.get(variantId);
        return onHand
          ? {
              onHand,
              reserved:
                reservedByVariant.get(variantId) ?? new Prisma.Decimal(0),
            }
          : null;
      },
    },
  };
}

function buildService(params: {
  claimed: ClaimedUnasStockSyncOutboxRow[];
  isSuperseded?: (
    row: ClaimedUnasStockSyncOutboxRow,
  ) => { supersededByOutboxId: string } | null;
  onHandByVariant?: Map<string, Prisma.Decimal>;
  reservedByVariant?: Map<string, Prisma.Decimal>;
  packageVariantIds?: Set<string>;
  setStock?: (sku: string, qty: string) => Promise<unknown>;
}) {
  const { repository, calls } = buildFakeRepository({
    claimed: params.claimed,
    isSuperseded: params.isSuperseded,
  });
  const setStockCalls: Array<{ sku: string; qty: string }> = [];
  const unasApi = {
    setStock: async (_token: string, request: { sku: string; qty: string }) => {
      setStockCalls.push({ sku: request.sku, qty: request.qty });
      if (params.setStock) return params.setStock(request.sku, request.qty);
      return { externalId: "1", sku: request.sku };
    },
  } as unknown as UnasApiClient;
  let authCallCount = 0;
  const unasAuth = {
    getToken: async () => {
      authCallCount += 1;
      return "token";
    },
  } as unknown as UnasAuthService;
  const stockLookup = buildFakeStockLookup(
    params.onHandByVariant ?? new Map(),
    params.reservedByVariant ?? new Map(),
    params.packageVariantIds ?? new Set(),
  );
  const service = new UnasStockSyncOutboxService(
    repository,
    unasApi,
    unasAuth,
    stockLookup,
  );
  return {
    service,
    calls,
    setStockCalls,
    getAuthCallCount: () => authCallCount,
  };
}

describe("computeNextAttemptDelayMs", () => {
  it("grows exponentially and is capped at maxMs", () => {
    const noJitter = () => 0.5; // midpoint -> multiplier exactly 1
    assert.equal(computeNextAttemptDelayMs(1, 1000, 60_000, noJitter), 1000);
    assert.equal(computeNextAttemptDelayMs(2, 1000, 60_000, noJitter), 2000);
    assert.equal(computeNextAttemptDelayMs(3, 1000, 60_000, noJitter), 4000);
    assert.equal(computeNextAttemptDelayMs(20, 1000, 60_000, noJitter), 60_000);
  });
});

describe("UnasStockSyncOutboxService.processBatch", () => {
  it("publishes the freshly re-read StockItem quantity, not the stale outbox snapshot, and marks the row SUCCEEDED", async () => {
    const claimed = row({ targetOnHand: new Prisma.Decimal("5") });
    const { service, calls, setStockCalls } = buildService({
      claimed: [claimed],
      onHandByVariant: new Map([
        ["variant-1", new Prisma.Decimal("3")], // stock moved again since the row was written
      ]),
    });

    const summary = await service.processBatch(config());

    assert.equal(summary.claimed, 1);
    assert.equal(summary.succeeded, 1);
    assert.equal(setStockCalls.length, 1);
    assert.equal(setStockCalls[0]?.qty, "3");
    assert.deepEqual(calls.markSucceededIds, ["outbox-1"]);
  });

  it("falls back to the outbox's targetOnHand when the StockItem row can't be found", async () => {
    const claimed = row({ targetOnHand: new Prisma.Decimal("7") });
    const { service, setStockCalls } = buildService({
      claimed: [claimed],
      onHandByVariant: new Map(),
    });

    await service.processBatch(config());

    assert.equal(setStockCalls[0]?.qty, "7");
  });

  it("publishes available stock after subtracting active reservations", async () => {
    const claimed = row({ targetOnHand: new Prisma.Decimal("8") });
    const { service, setStockCalls } = buildService({
      claimed: [claimed],
      onHandByVariant: new Map([["variant-1", new Prisma.Decimal("10")]]),
      reservedByVariant: new Map([["variant-1", new Prisma.Decimal("4")]]),
    });

    await service.processBatch(config());

    assert.equal(setStockCalls[0]?.qty, "6");
  });

  it("skips the UNAS call and marks superseded-success when a newer outbox row exists for the same key", async () => {
    const claimed = row();
    const { service, calls, setStockCalls } = buildService({
      claimed: [claimed],
      isSuperseded: () => ({ supersededByOutboxId: "outbox-2" }),
    });

    const summary = await service.processBatch(config());

    assert.equal(summary.superseded, 1);
    assert.equal(
      setStockCalls.length,
      0,
      "must never call UNAS for a superseded row",
    );
    assert.deepEqual(calls.markSupersededSuccessArgs, [
      { id: "outbox-1", by: "outbox-2" },
    ]);
  });

  it("closes a package-product row locally without acquiring a token or calling setStock", async () => {
    const claimed = row();
    const { service, calls, setStockCalls, getAuthCallCount } = buildService({
      claimed: [claimed],
      packageVariantIds: new Set(["variant-1"]),
    });

    const summary = await service.processBatch(config());

    assert.equal(summary.superseded, 1);
    assert.equal(getAuthCallCount(), 0);
    assert.equal(setStockCalls.length, 0);
    assert.deepEqual(calls.markPackageProductSuccessIds, ["outbox-1"]);
  });

  it("schedules a retry with backoff on a transient error, keeping retry budget", async () => {
    const claimed = row({ attempts: 2 });
    const { service, calls } = buildService({
      claimed: [claimed],
      setStock: async () => {
        throw new UnasApiError("HTTP_5XX");
      },
    });

    const summary = await service.processBatch(config({ maxAttempts: 5 }));

    assert.equal(summary.retried, 1);
    assert.equal(calls.markFailedForRetryArgs.length, 1);
    const args = calls.markFailedForRetryArgs[0] as {
      id: string;
      lastError: string;
      nextAttemptAt: Date;
    };
    assert.equal(args.id, "outbox-1");
    assert.equal(args.lastError, "HTTP_5XX");
    assert.ok(args.nextAttemptAt.getTime() > Date.now());
  });

  it("moves to DEAD_LETTER once attempts reach the configured maximum, even for a transient error code", async () => {
    const claimed = row({ attempts: 3 });
    const { service, calls } = buildService({
      claimed: [claimed],
      setStock: async () => {
        throw new UnasApiError("NETWORK_FAILED");
      },
    });

    const summary = await service.processBatch(config({ maxAttempts: 3 }));

    assert.equal(summary.deadLettered, 1);
    assert.deepEqual(calls.markDeadLetterArgs, [
      { id: "outbox-1", lastError: "NETWORK_FAILED" },
    ]);
    assert.equal(calls.markFailedForRetryArgs.length, 0);
  });

  it("moves permanent error codes straight to DEAD_LETTER regardless of remaining attempt budget", async () => {
    const claimed = row({ attempts: 1 });
    const { service, calls } = buildService({
      claimed: [claimed],
      setStock: async () => {
        throw new UnasApiError("REQUEST_INVALID");
      },
    });

    const summary = await service.processBatch(config({ maxAttempts: 8 }));

    assert.equal(summary.deadLettered, 1);
    assert.deepEqual(calls.markDeadLetterArgs, [
      { id: "outbox-1", lastError: "REQUEST_INVALID" },
    ]);
  });

  it("treats a missing/invalid UNAS product link (API_REJECTED) as a safe, retryable failure rather than crashing the batch", async () => {
    const claimed = row({ attempts: 1, sku: "NOT-LINKED-SKU" });
    const { service, calls, setStockCalls } = buildService({
      claimed: [claimed],
      setStock: async () => {
        throw new UnasApiError("API_REJECTED");
      },
    });

    const summary = await service.processBatch(config({ maxAttempts: 5 }));

    assert.equal(setStockCalls.length, 1);
    assert.equal(summary.retried, 1);
    assert.equal(
      (calls.markFailedForRetryArgs[0] as { lastError: string }).lastError,
      "API_REJECTED",
    );
  });

  it("never persists a raw, potentially sensitive error message - only a safe fallback code", async () => {
    const claimed = row({ attempts: 1 });
    const { service, calls } = buildService({
      claimed: [claimed],
      setStock: async () => {
        throw new Error(
          "request failed with token Bearer abc123secret and body <Params>...</Params>",
        );
      },
    });

    await service.processBatch(config({ maxAttempts: 5 }));

    const stored = (calls.markFailedForRetryArgs[0] as { lastError: string })
      .lastError;
    assert.equal(stored, "UNAS_STOCK_SYNC_UNEXPECTED_ERROR");
    assert.ok(!stored.includes("secret"));
    assert.ok(!stored.includes("Bearer"));
  });

  it("processes a batch of multiple claimed rows independently", async () => {
    const claimed = [
      row({ id: "outbox-1", variantId: "variant-1" }),
      row({ id: "outbox-2", variantId: "variant-2", sku: "SKU-2" }),
    ];
    const { service, calls } = buildService({ claimed });

    const summary = await service.processBatch(config());

    assert.equal(summary.claimed, 2);
    assert.equal(summary.succeeded, 2);
    assert.deepEqual(calls.markSucceededIds.sort(), ["outbox-1", "outbox-2"]);
  });

  it("returns an all-zero summary without calling UNAS when nothing is claimed", async () => {
    const { service, setStockCalls } = buildService({ claimed: [] });

    const summary = await service.processBatch(config());

    assert.equal(summary.claimed, 0);
    assert.equal(setStockCalls.length, 0);
  });
});
