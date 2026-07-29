/// DTOs for the read-only historical UNAS order audit
/// (unas-order-stock-audit.repository.ts / .service.ts) - the "is it safe to
/// activate the checkpoint-4 delta engine against every already-imported
/// order" check required before relying on it in production. Never mutates
/// anything; see that file's own doc comment for what it actually queries.
export type UnasOrderAuditRiskFlag =
  /** channel="UNAS" SalesOrder with no ExternalReference(system="UNAS",
   * entityType="SalesOrder") row at all - shouldn't be possible given
   * createNewOrder always creates one in the same transaction, but checked
   * rather than assumed. */
  | "MISSING_EXTERNAL_REFERENCE"
  /** This order's UNAS key (ExternalReference.externalId) is shared by
   * more than one local SalesOrder - would break apply()'s
   * find-or-create-by-key logic (two local orders racing to "own" the same
   * UNAS order). */
  | "DUPLICATE_UNAS_KEY"
  /** Order is not CANCELLED and its current SalesOrderLine rows imply a
   * positive targetOut for at least one variant, but the ledger shows
   * bookedOut=0 (or no SALE/RETURN_IN movement at all) for that variant -
   * i.e. this order has never actually had its stock effect posted under
   * ANY model (old or new) and needs a resync. */
  | "ACTIVE_ORDER_ZERO_BOOKED"
  /** Order is CANCELLED but the ledger still shows a positive bookedOut for
   * at least one variant - the cancellation's stock reversal either never
   * ran or hasn't been reprocessed since deploy. */
  | "CANCELLED_ORDER_POSITIVE_BOOKED"
  /** bookedOut is negative for some variant - structurally impossible under
   * correct operation (more RETURN_IN than SALE for the same order/variant)
   * and always worth investigating by hand. */
  | "NEGATIVE_BOOKED_QUANTITY";

export interface UnasOrderAuditRow {
  salesOrderId: string;
  orderNumber: string;
  status: string;
  unasKey: string | null;
  bookedOutByVariant: Record<string, string>;
  targetOutByVariant: Record<string, string>;
  deltaByVariant: Record<string, string>;
  riskFlags: UnasOrderAuditRiskFlag[];
}

export interface UnasOrderAuditPage {
  items: UnasOrderAuditRow[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface UnasOrderAuditAnomalies {
  checkedAt: string;
  duplicateUnasKeys: Array<{ unasKey: string; salesOrderIds: string[] }>;
  /** Distinct StockMovement.referenceId values (referenceType="SalesOrder",
   * type IN (SALE, RETURN_IN)) that don't correspond to any existing
   * SalesOrder row. */
  orphanStockMovementReferenceIds: string[];
}

export interface UnasOrderAuditSummary {
  checkedAt: string;
  ordersChecked: number;
  ordersWithRiskFlags: number;
  riskFlagCounts: Record<UnasOrderAuditRiskFlag, number>;
  duplicateUnasKeyCount: number;
  orphanStockMovementReferenceCount: number;
  /** Whether, based purely on what this audit found, the checkpoint-4 delta
   * engine can be trusted against every already-imported order without a
   * corrective backfill first - see docs/INVENTORY-CONSISTENCY.md. False
   * whenever any row above has a risk flag, or any global anomaly exists;
   * a clean audit alone does not "activate" anything by itself, it just
   * removes this particular blocker. */
  safeToActivateWithoutBackfill: boolean;
  blockingReasons: string[];
}
