/// DTOs for the checkpoint-6 auditable stock-reconciliation repair
/// mechanism (stock-reconciliation-repair.{util,repository,service,
/// controller}.ts). See docs/INVENTORY-CONSISTENCY.md's "Biztonságos
/// javítási terv" for the full design rationale - in particular why only
/// two of the three originally-sketched repair types exist here.
export type StockReconciliationRepairType =
  | "LOCAL_FROM_PROVEN_LEDGER"
  | "REPUBLISH_LOCAL_TO_UNAS";

/// Persisted outcome of a non-dry-run repair attempt. There is
/// deliberately no FAILED value - see schema.prisma's own doc comment on
/// the Prisma enum this mirrors: a genuine unexpected error rolls back the
/// WHOLE transaction, including the audit-row insert itself, so no row
/// (partial or otherwise) is ever left behind for that case.
export type StockReconciliationRepairStatus = "APPLIED" | "NOOP" | "REJECTED";

/// Closed set of reasons a repair attempt (dry-run or real) can be
/// rejected - always machine-checkable, never a free-text guess.
export type RepairRejectionCode =
  | "LEDGER_NOT_PROVABLE"
  | "STALE_EXPECTED_CURRENT_VALUE"
  | "MISSING_UNAS_LINK"
  | "ALREADY_QUEUED";

export interface StockReconciliationRepairRecord {
  id: string;
  repairType: StockReconciliationRepairType;
  status: StockReconciliationRepairStatus;
  stockItemId: string | null;
  variantId: string;
  warehouseId: string;
  actorUserId: string;
  reason: string;
  expectedCurrentOnHand: string;
  beforeOnHand: string | null;
  afterOnHand: string | null;
  ledgerExpectedOnHand: string | null;
  outboxId: string | null;
  rejectionCode: RepairRejectionCode | null;
  createdAt: string;
  completedAt: string | null;
}

/// Uniform result shape for both repair types, whether or not the attempt
/// was persisted. `dryRun: true` guarantees nothing was written anywhere
/// (no StockItem/outbox/audit row) - `repairId`/`outboxId` are then always
/// null by construction, not just coincidentally absent.
export interface StockReconciliationRepairOutcome {
  dryRun: boolean;
  status: StockReconciliationRepairStatus;
  rejectionCode: RepairRejectionCode | null;
  variantId: string;
  warehouseId: string;
  ledgerExpectedOnHand: string | null;
  beforeOnHand: string | null;
  afterOnHand: string | null;
  outboxId: string | null;
  /** Null exactly when dryRun is true. Non-null for every persisted
   * outcome (APPLIED, NOOP, and REJECTED all get an audit row when
   * dryRun is false) - see the repair type's own doc comment for why
   * REJECTED is still worth auditing. */
  repairId: string | null;
  /** True when this exact idempotencyKey already had a persisted repair
   * row BEFORE this call - the returned outcome is that prior row's
   * result, not a fresh computation. Always false for a dry-run (dry-run
   * never checks or touches persisted repair history). */
  replayedExisting: boolean;
}

export interface RepairLocalFromProvenLedgerInput {
  stockItemId: string;
  expectedCurrentOnHand: string;
  reason: string;
  actorUserId: string;
  dryRun: boolean;
}

export interface RepublishLocalToUnasInput {
  stockItemId: string;
  expectedCurrentOnHand: string;
  reason: string;
  actorUserId: string;
  dryRun: boolean;
}
