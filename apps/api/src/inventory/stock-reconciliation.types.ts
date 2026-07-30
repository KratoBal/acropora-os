/// Shared read-only DTOs for the stock-reconciliation/diagnostics module
/// (stock-reconciliation.repository.ts, .service.ts, .controller.ts) and the
/// UNAS historical-order audit (../orders/unas-order-sync/
/// unas-order-stock-audit.repository.ts, .service.ts). Deliberately plain
/// TypeScript unions, NOT Prisma enums - these are runtime-computed
/// diagnostic classifications, never stored, so a schema migration isn't
/// needed (and shouldn't be) just to add or refine a status. See
/// docs/INVENTORY-CONSISTENCY.md's reconciliation section for the full
/// rationale behind each status.

/// Per (variantId, warehouseId) diagnostic status. See
/// stock-reconciliation.service.ts's computeStatus for the exact decision
/// order between these.
export type ReconciliationStatus =
  /** Ledger, local StockItem and UNAS (where linked) all agree - nothing to
   * do. */
  | "CONSISTENT"
  /** The provable ledger sum and StockItem.onHand disagree - either a
   * genuine writer bug, or something wrote to StockItem outside
   * postInventoryMovement. Always worth investigating; never expected. */
  | "LOCAL_LEDGER_MISMATCH"
  /** Local and UNAS differ, but there is a PENDING or FAILED-with-remaining-
   * attempts outbox row already queued to correct it - normal operational
   * lag, not an incident. */
  | "UNAS_BEHIND_PENDING_SYNC"
  /** Local and UNAS differ and there is NO outbox row that would ever fix
   * it (none exists, or the only rows are terminal DEAD_LETTER/SUPERSEDED
   * without a fresh one behind them) - needs a manual republish. */
  | "UNAS_MISMATCH_NO_PENDING_SYNC"
  /** The most recent outbox row for this pair is DEAD_LETTER - the worker
   * gave up; distinct from UNAS_MISMATCH_NO_PENDING_SYNC only in that this
   * fires even when, coincidentally, local and UNAS currently agree (the
   * dead-letter itself is still worth surfacing). */
  | "SYNC_FAILED"
  /** The latest outbox row is PROCESSING but its lease has expired - a
   * worker likely crashed mid-publish; the next worker tick will reclaim it
   * (see unas-stock-sync-outbox.repository.ts's claimBatch), this status
   * just makes the stuck window visible before that happens. */
  | "PROCESSING_LEASE_EXPIRED"
  /** No StockItem row exists at all for this (variantId, warehouseId) -
   * never touched locally (e.g. UNAS reports a stock value for a product
   * this warehouse has never received/sold). */
  | "MISSING_STOCK_ITEM"
  /** A local StockItem/variant exists but no UNAS product/snapshot links to
   * it - nothing to compare against on the UNAS side. */
  | "MISSING_UNAS_LINK"
  /** StockItem.onHand exists with no ledger trace explaining it at all (zero
   * StockMovementLine rows for this pair) - it was set by a non-ledgered
   * path (the leltár "baseline-only" line via setStockItemQuantity, or a
   * pre-checkpoint-3 direct write) and its origin can't be reconstructed.
   * Not itself an error - this is the EXPECTED state for any variant whose
   * only local history predates the ledger - but it must never be silently
   * treated as "ledger says 0". */
  | "HISTORICAL_BASELINE_UNKNOWN"
  /** At least one ADJUSTMENT (or otherwise sign-ambiguous/unrecognized)
   * movement touches this pair, so the ledger's sum can't be trusted as the
   * whole story - see stock-ledger.util.ts's long doc comment on why
   * ADJUSTMENT's sign isn't recoverable from the stored row. */
  | "INVALID_LEDGER_DATA";

export type OutboxLatestStatus =
  "PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "DEAD_LETTER" | "NONE";

export interface OutboxDiagnosis {
  latestStatus: OutboxLatestStatus;
  /** True when a PENDING or a FAILED-with-remaining-retry-budget row exists
   * that has NOT yet been superseded - i.e. a correction is already queued.
   * (Whether attempts remain is intentionally left to the worker's own
   * classification (unas-stock-sync-outbox.service.ts) - this flag only
   * distinguishes "something is queued" from "nothing is queued".) */
  hasPendingCorrection: boolean;
  /** Non-null only when the latest row is PROCESSING: whether its lease has
   * already expired (stuck, awaiting reclaim) or is still active (worker is
   * plausibly still working it). */
  processingLeaseExpired: boolean | null;
  /** True when every row on record for this pair is SUCCEEDED via
   * supersede (resolutionNote set) rather than an actual UNAS publish, or
   * there are simply no non-superseded rows left. */
  onlySupersededRows: boolean;
  /** The most recent row's publishable target (onHand - reserved) at the
   * time it was created, if any ever existed for this pair - compared
   * against the current local available quantity below to
   * catch "worker reported success, but local stock has since moved and
   * nothing queued the follow-up" (shouldn't happen given the writer's own
   * supersede-on-write step, but checked independently here rather than
   * assumed). */
  latestRecordedTargetOnHand: string | null;
  /** False only when the latest row is SUCCEEDED (a real publish, not a
   * supersede) and its target no longer matches current local available
   * quantity; null when there's no successful row to compare, or the pair
   * has no StockItem at all. */
  latestSuccessMatchesCurrentLocal: boolean | null;
  /** Count of rows still in PENDING or PROCESSING for this pair - more than
   * one at once would indicate the supersede step didn't run as expected. */
  competingOpenRowCount: number;
  lastSuccessfulPublishAt: string | null;
  lastFailureAt: string | null;
}

export interface StockReconciliationRow {
  variantId: string;
  sku: string;
  warehouseId: string;
  warehouseCode: string;
  ledgerProvable: boolean;
  /** Null when !ledgerProvable - never a guessed value. */
  ledgerExpectedOnHand: string | null;
  /** Null when no StockItem row exists at all. */
  localOnHand: string | null;
  /** Null when this variant's product has no UnasProductSnapshot, or the
   * product has more than one variant and this isn't its first (see this
   * file's own doc comment on the pre-existing findStockDiscrepancies
   * limitation this reuses). */
  unasOnHand: string | null;
  /** localOnHand - ledgerExpectedOnHand; null unless both sides are known. */
  localVsLedgerDelta: string | null;
  /** unasOnHand - (sum of localOnHand across ALL warehouses for this
   * variant, not just this row's warehouse) - see the module doc comment on
   * why this is warehouse-agnostic by necessity: UNAS only ever reports one
   * stock value per product, never per Acropora warehouse. Null unless both
   * sides are known. */
  unasVsLocalDelta: string | null;
  outbox: OutboxDiagnosis;
  status: ReconciliationStatus;
  /** Free-text, non-sensitive technical detail for investigation (e.g. "3
   * ADJUSTMENT movements found", "product has 2 variants, compared against
   * the first only") - never includes customer/order personal data. */
  notes: string[];
}

export interface StockReconciliationQuery {
  variantId?: string;
  warehouseId?: string;
  /** 1-based. */
  page: number;
  pageSize: number;
}

export interface StockReconciliationPage {
  items: StockReconciliationRow[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface StockReconciliationStatusCounts {
  checkedAt: string;
  checkedCount: number;
  byStatus: Record<ReconciliationStatus, number>;
}
