import type {
  DashboardStockReconciliationWidgetData,
  DashboardStockSyncOutboxWidgetData,
} from "@acropora/types";

import type { StockReconciliationService } from "../inventory/stock-reconciliation.service.js";
import type { ReconciliationStatus } from "../inventory/stock-reconciliation.types.js";
import type { UnasStockSyncOutboxRepository } from "../inventory/unas-stock-sync-outbox.repository.js";

/**
 * The ACTIONABLE reconciliation statuses: the old dashboard card's list, now
 * in one place for both. Left out on purpose: UNAS_BEHIND_PENDING_SYNC (a fix
 * is already queued), MISSING_UNAS_LINK and HISTORICAL_BASELINE_UNKNOWN (a
 * warning, not a difference to act on).
 */
export const DISCREPANCY_STATUSES: ReadonlySet<ReconciliationStatus> = new Set([
  "LOCAL_LEDGER_MISMATCH",
  "UNAS_MISMATCH_NO_PENDING_SYNC",
  "SYNC_FAILED",
  "PROCESSING_LEASE_EXPIRED",
  "MISSING_STOCK_ITEM",
  "INVALID_LEDGER_DATA",
]);

const ITEMS_SHOWN = 5;

/** Készlet-egyeztetés: exactly the old card's computation. */
export async function stockDiscrepancies(
  reconciliation: Pick<
    StockReconciliationService,
    "summarize" | "reconcilePage"
  >,
): Promise<DashboardStockReconciliationWidgetData> {
  const [summary, page] = await Promise.all([
    reconciliation.summarize({}),
    reconciliation.reconcilePage({ page: 1, pageSize: 200 }),
  ]);
  return {
    count: [...DISCREPANCY_STATUSES].reduce(
      (total, status) => total + summary.byStatus[status],
      0,
    ),
    items: page.items
      .filter((item) => DISCREPANCY_STATUSES.has(item.status))
      .slice(0, ITEMS_SHOWN)
      .map((item) => ({
        variantId: item.variantId,
        sku: item.sku,
        warehouseCode: item.warehouseCode,
        status: item.status,
      })),
  };
}

/**
 * Készlet-kimenősor, READ ONLY (owner decision 2026-10-02): two database
 * reads of the outbox repository. No write, no UNAS call, and the successful
 * rows are not shown: a background job that works needs no one.
 */
export async function stockSyncOutboxState(
  outbox: Pick<
    UnasStockSyncOutboxRepository,
    "countsByStatus" | "lastSuccessfulPublishAt"
  >,
): Promise<DashboardStockSyncOutboxWidgetData> {
  const [counts, lastSuccess] = await Promise.all([
    outbox.countsByStatus(),
    outbox.lastSuccessfulPublishAt(),
  ]);
  return {
    queued: counts.PENDING + counts.PROCESSING,
    retrying: counts.FAILED,
    deadLetter: counts.DEAD_LETTER,
    lastSuccessfulSyncAt: lastSuccess ? lastSuccess.toISOString() : null,
  };
}
