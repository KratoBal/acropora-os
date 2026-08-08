import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@acropora/database";

import {
  UnasStockSyncOutboxRepository,
  type UnasStockSyncOutboxDatabase,
} from "./unas-stock-sync-outbox.repository.js";

interface FakeRow {
  id: string;
  variantId: string;
  warehouseId: string;
  sequence: bigint;
  status: string;
}

function buildFakeDatabase(options: {
  queryRawImpl?: (values: unknown[]) => unknown;
  outboxRows?: FakeRow[];
}) {
  const updateCalls: unknown[] = [];
  const updateManyCalls: unknown[] = [];
  const rows = options.outboxRows ?? [];
  const database: UnasStockSyncOutboxDatabase = {
    async $queryRaw(_strings, ...values) {
      if (options.queryRawImpl) return options.queryRawImpl(values) as never;
      return [] as never;
    },
    unasStockSyncOutbox: {
      async findFirst(args) {
        const where = (args as { where: { id: string } }).where;
        const found = rows.find((r) => r.id === where.id);
        return found ? { id: found.id, status: found.status as never } : null;
      },
      async findMany() {
        return [];
      },
      async update(args) {
        updateCalls.push(args);
        return {};
      },
      async updateMany(args) {
        updateManyCalls.push(args);
        const where = (
          args as { where: { id: string; status: { in: string[] } } }
        ).where;
        const found = rows.find(
          (r) => r.id === where.id && where.status.in.includes(r.status),
        );
        return { count: found ? 1 : 0 };
      },
      async groupBy() {
        return [];
      },
      async aggregate() {
        return { _max: { processedAt: null } };
      },
    },
  };
  return { database, updateCalls, updateManyCalls };
}

describe("UnasStockSyncOutboxRepository.claimBatch", () => {
  it("passes batchSize, leaseSeconds and workerId through to the claim SQL and returns the RETURNING rows", async () => {
    let capturedValues: unknown[] = [];
    const claimedRow = {
      id: "outbox-1",
      variantId: "variant-1",
      warehouseId: "warehouse-1",
      sku: "SKU-1",
      targetOnHand: new Prisma.Decimal("3"),
      idempotencyKey: "POS_SALE:ORDER-1:variant-1",
      sourceProcess: "POS_SALE",
      sourceRecordId: "order-1",
      attempts: 1,
      sequence: 1n,
    };
    const { database } = buildFakeDatabase({
      queryRawImpl: (values) => {
        capturedValues = values;
        return [claimedRow];
      },
    });
    const repository = new UnasStockSyncOutboxRepository(database);

    const claimed = await repository.claimBatch({
      batchSize: 25,
      leaseSeconds: 90,
      workerId: "worker-abc",
    });

    assert.deepEqual(claimed, [claimedRow]);
    assert.deepEqual(capturedValues, [25, 90, "worker-abc"]);
  });
});

describe("UnasStockSyncOutboxRepository.claimForUnasOrder", () => {
  it("passes only the exact SalesOrder id and claim lease parameters to the targeted SQL", async () => {
    let capturedValues: unknown[] = [];
    const claimedRow = {
      id: "outbox-recovery",
      variantId: "variant-1",
      warehouseId: "warehouse-1",
      sku: "SKU-1",
      targetOnHand: new Prisma.Decimal("3"),
      idempotencyKey: "UNAS_ORDER:KEY:g2:SALE:variant-1",
      sourceProcess: "UNAS_ORDER_UPDATE",
      sourceRecordId: "order-1",
      attempts: 1,
      sequence: 9n,
    };
    const { database } = buildFakeDatabase({
      queryRawImpl: (values) => {
        capturedValues = values;
        return [claimedRow];
      },
    });
    const repository = new UnasStockSyncOutboxRepository(database);

    const claimed = await repository.claimForUnasOrder({
      orderId: "order-1",
      batchSize: 20,
      leaseSeconds: 120,
      workerId: "manual-worker",
    });

    assert.deepEqual(claimed, [claimedRow]);
    assert.deepEqual(capturedValues, ["order-1", 20, 120, "manual-worker"]);
  });
});

describe("UnasStockSyncOutboxRepository.isSuperseded", () => {
  it("returns null when this row is already the latest for its key", async () => {
    const { database } = buildFakeDatabase({
      queryRawImpl: () => [{ id: "outbox-1", sequence: 5n }],
    });
    const repository = new UnasStockSyncOutboxRepository(database);

    const result = await repository.isSuperseded({
      id: "outbox-1",
      variantId: "variant-1",
      warehouseId: "warehouse-1",
      sequence: 5n,
    });

    assert.equal(result, null);
  });

  it("returns the newer row's id when a higher-sequence row exists for the same key", async () => {
    const { database } = buildFakeDatabase({
      queryRawImpl: () => [{ id: "outbox-2", sequence: 9n }],
    });
    const repository = new UnasStockSyncOutboxRepository(database);

    const result = await repository.isSuperseded({
      id: "outbox-1",
      variantId: "variant-1",
      warehouseId: "warehouse-1",
      sequence: 5n,
    });

    assert.deepEqual(result, { supersededByOutboxId: "outbox-2" });
  });

  it("returns null when no row at all is found for the key (defensive)", async () => {
    const { database } = buildFakeDatabase({ queryRawImpl: () => [] });
    const repository = new UnasStockSyncOutboxRepository(database);

    const result = await repository.isSuperseded({
      id: "outbox-1",
      variantId: "variant-1",
      warehouseId: "warehouse-1",
      sequence: 5n,
    });

    assert.equal(result, null);
  });
});

describe("UnasStockSyncOutboxRepository.manualRetry", () => {
  it("resets a DEAD_LETTER row to PENDING with attempts cleared", async () => {
    const { database, updateManyCalls } = buildFakeDatabase({
      outboxRows: [
        {
          id: "outbox-1",
          variantId: "v",
          warehouseId: "w",
          sequence: 1n,
          status: "DEAD_LETTER",
        },
      ],
    });
    const repository = new UnasStockSyncOutboxRepository(database);

    const result = await repository.manualRetry("outbox-1", "user-1");

    assert.deepEqual(result, { retried: true, status: "PENDING" });
    const call = updateManyCalls[0] as {
      data: { attempts: number; status: string };
    };
    assert.equal(call.data.status, "PENDING");
    assert.equal(call.data.attempts, 0);
  });

  it("is a safe no-op (not an error) when called on a row that is not FAILED/DEAD_LETTER", async () => {
    const { database, updateManyCalls } = buildFakeDatabase({
      outboxRows: [
        {
          id: "outbox-1",
          variantId: "v",
          warehouseId: "w",
          sequence: 1n,
          status: "SUCCEEDED",
        },
      ],
    });
    const repository = new UnasStockSyncOutboxRepository(database);

    const result = await repository.manualRetry("outbox-1", "user-1");

    assert.deepEqual(result, { retried: false, status: "SUCCEEDED" });
    assert.equal(updateManyCalls.length, 0);
  });

  it("throws a clear error when the row does not exist", async () => {
    const { database } = buildFakeDatabase({ outboxRows: [] });
    const repository = new UnasStockSyncOutboxRepository(database);

    await assert.rejects(() => repository.manualRetry("missing", "user-1"));
  });
});

describe("UnasStockSyncOutboxRepository mark* methods", () => {
  it("markSucceeded sets status SUCCEEDED and clears the lease", async () => {
    const { database, updateCalls } = buildFakeDatabase({});
    const repository = new UnasStockSyncOutboxRepository(database);

    await repository.markSucceeded("outbox-1");

    const call = updateCalls[0] as {
      data: { status: string; leaseExpiresAt: null };
    };
    assert.equal(call.data.status, "SUCCEEDED");
    assert.equal(call.data.leaseExpiresAt, null);
  });

  it("markFailedForRetry sets status FAILED with the given nextAttemptAt and clears the lease", async () => {
    const { database, updateCalls } = buildFakeDatabase({});
    const repository = new UnasStockSyncOutboxRepository(database);
    const nextAttemptAt = new Date(Date.now() + 5000);

    await repository.markFailedForRetry({
      id: "outbox-1",
      lastError: "HTTP_5XX",
      nextAttemptAt,
    });

    const call = updateCalls[0] as {
      data: {
        status: string;
        lastError: string;
        nextAttemptAt: Date;
        leaseExpiresAt: null;
      };
    };
    assert.equal(call.data.status, "FAILED");
    assert.equal(call.data.lastError, "HTTP_5XX");
    assert.equal(call.data.nextAttemptAt, nextAttemptAt);
    assert.equal(call.data.leaseExpiresAt, null);
  });

  it("markDeadLetter sets status DEAD_LETTER and clears the lease", async () => {
    const { database, updateCalls } = buildFakeDatabase({});
    const repository = new UnasStockSyncOutboxRepository(database);

    await repository.markDeadLetter({
      id: "outbox-1",
      lastError: "REQUEST_INVALID",
    });

    const call = updateCalls[0] as {
      data: { status: string; lastError: string };
    };
    assert.equal(call.data.status, "DEAD_LETTER");
    assert.equal(call.data.lastError, "REQUEST_INVALID");
  });
});
