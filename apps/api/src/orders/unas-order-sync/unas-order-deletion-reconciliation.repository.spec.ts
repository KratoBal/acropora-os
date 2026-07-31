import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  UnasOrderDeletionReconciliationRepository,
  type UnasOrderDeletionReconciliationDatabase,
} from "./unas-order-deletion-reconciliation.repository.js";

function buildFakeDatabase(options: {
  queryRawImpl?: (values: unknown[]) => unknown;
}) {
  const updateCalls: unknown[] = [];
  const database: UnasOrderDeletionReconciliationDatabase = {
    async $queryRaw(_strings, ...values) {
      if (options.queryRawImpl) return options.queryRawImpl(values) as never;
      return [] as never;
    },
    salesOrder: {
      async update(args: unknown) {
        updateCalls.push(args);
        return {};
      },
    },
  };
  return { database, updateCalls };
}

describe("UnasOrderDeletionReconciliationRepository.claimBatch", () => {
  it("passes batchSize, leaseSeconds and workerId through to the claim SQL and returns the RETURNING rows", async () => {
    let capturedValues: unknown[] = [];
    const claimedRow = { id: "order-1", unasKey: "UN-1", attempts: 1 };
    const { database } = buildFakeDatabase({
      queryRawImpl: (values) => {
        capturedValues = values;
        return [claimedRow];
      },
    });
    const repository = new UnasOrderDeletionReconciliationRepository(database);

    const claimed = await repository.claimBatch({
      batchSize: 10,
      leaseSeconds: 120,
      workerId: "worker-abc",
    });

    assert.deepEqual(claimed, [claimedRow]);
    assert.deepEqual(capturedValues, [10, 120, "worker-abc"]);
  });

  it("returns an empty array (and never throws) when nothing is claimable", async () => {
    const { database } = buildFakeDatabase({ queryRawImpl: () => [] });
    const repository = new UnasOrderDeletionReconciliationRepository(database);

    const claimed = await repository.claimBatch({
      batchSize: 10,
      leaseSeconds: 120,
      workerId: "worker-abc",
    });

    assert.deepEqual(claimed, []);
  });

  it("surfaces a defensively-null unasKey for a claimed row with no resolvable ExternalReference", async () => {
    const claimedRow = { id: "order-2", unasKey: null, attempts: 3 };
    const { database } = buildFakeDatabase({
      queryRawImpl: () => [claimedRow],
    });
    const repository = new UnasOrderDeletionReconciliationRepository(database);

    const claimed = await repository.claimBatch({
      batchSize: 10,
      leaseSeconds: 120,
      workerId: "worker-abc",
    });

    assert.equal(claimed[0]?.unasKey, null);
  });
});

describe("UnasOrderDeletionReconciliationRepository.releaseAfterCheck", () => {
  it("clears the lease/claimant and schedules the next due-at, never touching status/unasDeletedAt", async () => {
    const { database, updateCalls } = buildFakeDatabase({});
    const repository = new UnasOrderDeletionReconciliationRepository(database);
    const before = Date.now();

    await repository.releaseAfterCheck({
      orderId: "order-1",
      nextCheckDelayMs: 60_000,
    });

    const call = updateCalls[0] as {
      where: { id: string };
      data: {
        unasExistenceCheckDueAt: Date;
        unasExistenceCheckLeaseExpiresAt: null;
        unasExistenceCheckClaimedBy: null;
      };
    };
    assert.equal(call.where.id, "order-1");
    assert.equal(call.data.unasExistenceCheckLeaseExpiresAt, null);
    assert.equal(call.data.unasExistenceCheckClaimedBy, null);
    assert.ok(call.data.unasExistenceCheckDueAt.getTime() >= before + 60_000);
    assert.ok(!("status" in call.data));
    assert.ok(!("unasDeletedAt" in call.data));
  });
});

describe("UnasOrderDeletionReconciliationRepository.clearAfterDeletion", () => {
  it("clears the existence-check bookkeeping only, leaving order/stock fields untouched", async () => {
    const { database, updateCalls } = buildFakeDatabase({});
    const repository = new UnasOrderDeletionReconciliationRepository(database);

    await repository.clearAfterDeletion("order-1");

    const call = updateCalls[0] as {
      where: { id: string };
      data: Record<string, unknown>;
    };
    assert.equal(call.where.id, "order-1");
    assert.equal(call.data.unasExistenceCheckDueAt, null);
    assert.equal(call.data.unasExistenceCheckLeaseExpiresAt, null);
    assert.equal(call.data.unasExistenceCheckClaimedBy, null);
    assert.ok(!("status" in call.data));
    assert.ok(!("unasDeletedAt" in call.data));
  });
});

describe("UnasOrderDeletionReconciliationRepository.skipUnresolvable", () => {
  it("behaves exactly like releaseAfterCheck for a candidate with no resolvable Key", async () => {
    const { database, updateCalls } = buildFakeDatabase({});
    const repository = new UnasOrderDeletionReconciliationRepository(database);

    await repository.skipUnresolvable({
      orderId: "order-1",
      nextCheckDelayMs: 3_600_000,
    });

    assert.equal(updateCalls.length, 1);
    const call = updateCalls[0] as { where: { id: string } };
    assert.equal(call.where.id, "order-1");
  });
});
