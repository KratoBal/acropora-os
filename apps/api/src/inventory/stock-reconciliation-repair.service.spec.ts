import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { StockReconciliationRepairRepository } from "./stock-reconciliation-repair.repository.js";
import { StockReconciliationRepairService } from "./stock-reconciliation-repair.service.js";
import type {
  StockReconciliationRepairOutcome,
  StockReconciliationRepairRecord,
} from "./stock-reconciliation-repair.types.js";
import type { StockReconciliationRepository } from "./stock-reconciliation.repository.js";
import type { StockReconciliationRow } from "./stock-reconciliation.types.js";

function baseRow(overrides: Partial<StockReconciliationRow> = {}): StockReconciliationRow {
  return {
    variantId: "v1",
    sku: "sku-1",
    warehouseId: "wh-1",
    warehouseCode: "FO",
    ledgerProvable: true,
    ledgerExpectedOnHand: "7",
    localOnHand: "999",
    unasOnHand: null,
    localVsLedgerDelta: "992",
    unasVsLocalDelta: null,
    outbox: {
      latestStatus: "NONE",
      hasPendingCorrection: false,
      processingLeaseExpired: null,
      onlySupersededRows: false,
      latestRecordedTargetOnHand: null,
      latestSuccessMatchesCurrentLocal: null,
      competingOpenRowCount: 0,
      lastSuccessfulPublishAt: null,
      lastFailureAt: null,
    },
    status: "LOCAL_LEDGER_MISMATCH",
    notes: [],
    ...overrides,
  };
}

class FakeReconciliationRepository {
  row: StockReconciliationRow | null = null;
  calls = 0;
  async reconcileByStockItemId(_stockItemId: string): Promise<StockReconciliationRow | null> {
    this.calls += 1;
    return this.row;
  }
}

class FakeRepairRepository {
  byIdempotencyKey = new Map<string, StockReconciliationRepairRecord>();
  applyLocalCalls: unknown[] = [];
  applyRepublishCalls: unknown[] = [];
  applyLocalOutcome: StockReconciliationRepairOutcome | null = null;
  applyRepublishOutcome: StockReconciliationRepairOutcome | null = null;

  async findByIdempotencyKey(idempotencyKey: string) {
    return this.byIdempotencyKey.get(idempotencyKey) ?? null;
  }
  async findById(id: string) {
    return [...this.byIdempotencyKey.values()].find((row) => row.id === id) ?? null;
  }
  async applyLocalFromProvenLedger(params: unknown) {
    this.applyLocalCalls.push(params);
    return this.applyLocalOutcome!;
  }
  async applyRepublishLocalToUnas(params: unknown) {
    this.applyRepublishCalls.push(params);
    return this.applyRepublishOutcome!;
  }
}

function buildService(reconciliation: FakeReconciliationRepository, repairs: FakeRepairRepository) {
  return new StockReconciliationRepairService(
    reconciliation as unknown as StockReconciliationRepository,
    repairs as unknown as StockReconciliationRepairRepository,
  );
}

describe("StockReconciliationRepairService.repairLocalFromProvenLedger", () => {
  it("dry-run computes a preview and never calls the repository's transactional apply method", async () => {
    const reconciliation = new FakeReconciliationRepository();
    reconciliation.row = baseRow();
    const repairs = new FakeRepairRepository();
    const service = buildService(reconciliation, repairs);

    const outcome = await service.repairLocalFromProvenLedger({
      stockItemId: "si-1",
      expectedCurrentOnHand: "999",
      reason: "preview",
      actorUserId: "user-1",
      dryRun: true,
    });

    assert.equal(outcome.dryRun, true);
    assert.equal(outcome.status, "APPLIED");
    assert.equal(outcome.afterOnHand, "7");
    assert.equal(outcome.repairId, null);
    assert.equal(repairs.applyLocalCalls.length, 0);
  });

  it("dry-run surfaces the SAME rejection code the real path would produce (e.g. stale value)", async () => {
    const reconciliation = new FakeReconciliationRepository();
    reconciliation.row = baseRow({ localOnHand: "7" }); // caller thinks it's 999, actually 7
    const repairs = new FakeRepairRepository();
    const service = buildService(reconciliation, repairs);

    const outcome = await service.repairLocalFromProvenLedger({
      stockItemId: "si-1",
      expectedCurrentOnHand: "999",
      reason: "preview",
      actorUserId: "user-1",
      dryRun: true,
    });

    assert.equal(outcome.dryRun, true);
    assert.equal(outcome.status, "REJECTED");
    assert.equal(outcome.rejectionCode, "STALE_EXPECTED_CURRENT_VALUE");
  });

  it("a repeated call with the same idempotency-deriving inputs replays the persisted result without re-invoking the repository's apply method", async () => {
    const reconciliation = new FakeReconciliationRepository();
    reconciliation.row = baseRow();
    const repairs = new FakeRepairRepository();
    const existing: StockReconciliationRepairRecord = {
      id: "repair-1",
      repairType: "LOCAL_FROM_PROVEN_LEDGER",
      status: "APPLIED",
      stockItemId: "si-1",
      variantId: "v1",
      warehouseId: "wh-1",
      actorUserId: "user-1",
      reason: "first attempt",
      expectedCurrentOnHand: "999",
      beforeOnHand: "999",
      afterOnHand: "7",
      ledgerExpectedOnHand: "7",
      outboxId: "outbox-1",
      rejectionCode: null,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
    repairs.byIdempotencyKey.set(
      "RECONCILIATION_REPAIR:LOCAL_FROM_PROVEN_LEDGER:si-1:999",
      existing,
    );
    const service = buildService(reconciliation, repairs);

    const outcome = await service.repairLocalFromProvenLedger({
      stockItemId: "si-1",
      expectedCurrentOnHand: "999",
      reason: "second attempt - retried request",
      actorUserId: "user-1",
      dryRun: false,
    });

    assert.equal(outcome.replayedExisting, true);
    assert.equal(outcome.repairId, "repair-1");
    assert.equal(outcome.afterOnHand, "7");
    assert.equal(repairs.applyLocalCalls.length, 0); // never re-executed
    assert.equal(reconciliation.calls, 0); // short-circuited before even previewing
  });

  it("delegates to the repository's transactional apply method for a genuine (non-replayed, non-dry-run) request", async () => {
    const reconciliation = new FakeReconciliationRepository();
    reconciliation.row = baseRow();
    const repairs = new FakeRepairRepository();
    repairs.applyLocalOutcome = {
      dryRun: false,
      status: "APPLIED",
      rejectionCode: null,
      variantId: "v1",
      warehouseId: "wh-1",
      ledgerExpectedOnHand: "7",
      beforeOnHand: "999",
      afterOnHand: "7",
      outboxId: "outbox-1",
      repairId: "repair-1",
      replayedExisting: false,
    };
    const service = buildService(reconciliation, repairs);

    const outcome = await service.repairLocalFromProvenLedger({
      stockItemId: "si-1",
      expectedCurrentOnHand: "999",
      reason: "reason",
      actorUserId: "user-1",
      dryRun: false,
    });

    assert.equal(outcome.status, "APPLIED");
    assert.equal(repairs.applyLocalCalls.length, 1);
  });
});

describe("StockReconciliationRepairService.republishLocalToUnas", () => {
  it("dry-run rejects with MISSING_UNAS_LINK when the reconciliation preview has no UNAS link, without calling the repository", async () => {
    const reconciliation = new FakeReconciliationRepository();
    reconciliation.row = baseRow({ localOnHand: "12", unasOnHand: null });
    const repairs = new FakeRepairRepository();
    const service = buildService(reconciliation, repairs);

    const outcome = await service.republishLocalToUnas({
      stockItemId: "si-1",
      expectedCurrentOnHand: "12",
      reason: "reason",
      actorUserId: "user-1",
      dryRun: true,
    });

    assert.equal(outcome.dryRun, true);
    assert.equal(outcome.status, "REJECTED");
    assert.equal(outcome.rejectionCode, "MISSING_UNAS_LINK");
    assert.equal(repairs.applyRepublishCalls.length, 0);
  });
});
