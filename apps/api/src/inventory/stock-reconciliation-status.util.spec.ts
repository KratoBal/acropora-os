import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@acropora/database";

import { computeReconciliationStatus } from "./stock-reconciliation-status.util.js";
import type { OutboxDiagnosis } from "./stock-reconciliation.types.js";

function d(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

const noOutboxActivity: OutboxDiagnosis = {
  latestStatus: "NONE",
  hasPendingCorrection: false,
  processingLeaseExpired: null,
  onlySupersededRows: false,
  latestRecordedTargetOnHand: null,
  latestSuccessMatchesCurrentLocal: null,
  competingOpenRowCount: 0,
  lastSuccessfulPublishAt: null,
  lastFailureAt: null,
};

const baseParams = {
  hasStockItem: true,
  ledgerProvable: true,
  hasAnyMovement: true,
  localVsLedgerDelta: d("0"),
  hasUnasLink: true,
  unasVsLocalDelta: d("0"),
  outbox: noOutboxActivity,
};

describe("computeReconciliationStatus", () => {
  it("is CONSISTENT when local matches ledger and UNAS matches local", () => {
    assert.equal(computeReconciliationStatus(baseParams), "CONSISTENT");
  });

  it("is MISSING_STOCK_ITEM when there is no StockItem row at all, ahead of every other check", () => {
    assert.equal(
      computeReconciliationStatus({
        ...baseParams,
        hasStockItem: false,
        localVsLedgerDelta: null,
      }),
      "MISSING_STOCK_ITEM",
    );
  });

  it("is HISTORICAL_BASELINE_UNKNOWN when StockItem exists but no ledger movement ever explains it", () => {
    assert.equal(
      computeReconciliationStatus({
        ...baseParams,
        hasAnyMovement: false,
        ledgerProvable: false,
        localVsLedgerDelta: null,
      }),
      "HISTORICAL_BASELINE_UNKNOWN",
    );
  });

  it("is INVALID_LEDGER_DATA when a movement exists but its sign isn't provable (ADJUSTMENT present)", () => {
    assert.equal(
      computeReconciliationStatus({
        ...baseParams,
        ledgerProvable: false,
        localVsLedgerDelta: null,
      }),
      "INVALID_LEDGER_DATA",
    );
  });

  it("is LOCAL_LEDGER_MISMATCH when the provable ledger sum disagrees with StockItem.onHand", () => {
    assert.equal(
      computeReconciliationStatus({
        ...baseParams,
        localVsLedgerDelta: d("5"),
      }),
      "LOCAL_LEDGER_MISMATCH",
    );
  });

  it("takes priority for LOCAL_LEDGER_MISMATCH even when UNAS also disagrees - local integrity is checked first", () => {
    assert.equal(
      computeReconciliationStatus({
        ...baseParams,
        localVsLedgerDelta: d("5"),
        unasVsLocalDelta: d("5"),
      }),
      "LOCAL_LEDGER_MISMATCH",
    );
  });

  it("is MISSING_UNAS_LINK when local is fine but no UNAS product/snapshot links to this variant", () => {
    assert.equal(
      computeReconciliationStatus({
        ...baseParams,
        hasUnasLink: false,
        unasVsLocalDelta: null,
      }),
      "MISSING_UNAS_LINK",
    );
  });

  it("is UNAS_BEHIND_PENDING_SYNC when UNAS differs from local but a correction is already queued", () => {
    assert.equal(
      computeReconciliationStatus({
        ...baseParams,
        unasVsLocalDelta: d("3"),
        outbox: {
          ...noOutboxActivity,
          latestStatus: "PENDING",
          hasPendingCorrection: true,
        },
      }),
      "UNAS_BEHIND_PENDING_SYNC",
    );
  });

  it("also treats a retry-eligible FAILED row as a queued correction (UNAS_BEHIND_PENDING_SYNC, not a mismatch-with-nothing-queued)", () => {
    assert.equal(
      computeReconciliationStatus({
        ...baseParams,
        unasVsLocalDelta: d("3"),
        outbox: {
          ...noOutboxActivity,
          latestStatus: "FAILED",
          hasPendingCorrection: true,
        },
      }),
      "UNAS_BEHIND_PENDING_SYNC",
    );
  });

  it("is UNAS_MISMATCH_NO_PENDING_SYNC when UNAS differs from local and nothing is queued to fix it", () => {
    assert.equal(
      computeReconciliationStatus({ ...baseParams, unasVsLocalDelta: d("3") }),
      "UNAS_MISMATCH_NO_PENDING_SYNC",
    );
  });

  it("is SYNC_FAILED when the latest outbox row is DEAD_LETTER, even if local/UNAS happen to currently agree", () => {
    assert.equal(
      computeReconciliationStatus({
        ...baseParams,
        outbox: { ...noOutboxActivity, latestStatus: "DEAD_LETTER" },
      }),
      "SYNC_FAILED",
    );
  });

  it("is PROCESSING_LEASE_EXPIRED when the latest row is PROCESSING with an expired lease", () => {
    assert.equal(
      computeReconciliationStatus({
        ...baseParams,
        outbox: {
          ...noOutboxActivity,
          latestStatus: "PROCESSING",
          processingLeaseExpired: true,
        },
      }),
      "PROCESSING_LEASE_EXPIRED",
    );
  });

  it("is NOT PROCESSING_LEASE_EXPIRED when PROCESSING but the lease is still valid - falls through to a normal comparison", () => {
    assert.equal(
      computeReconciliationStatus({
        ...baseParams,
        outbox: {
          ...noOutboxActivity,
          latestStatus: "PROCESSING",
          processingLeaseExpired: false,
        },
      }),
      "CONSISTENT",
    );
  });

  it("treats a zero delta as CONSISTENT even when Decimal(0) is passed rather than null", () => {
    assert.equal(
      computeReconciliationStatus({
        ...baseParams,
        localVsLedgerDelta: d("0"),
        unasVsLocalDelta: d("0"),
      }),
      "CONSISTENT",
    );
  });
});
