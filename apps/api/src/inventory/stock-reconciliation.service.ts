import { Injectable } from "@nestjs/common";

import type {
  ReconciliationStatus,
  StockReconciliationPage,
  StockReconciliationQuery,
  StockReconciliationStatusCounts,
} from "./stock-reconciliation.types.js";
import { StockReconciliationRepository } from "./stock-reconciliation.repository.js";

// computeReconciliationStatus lives in stock-reconciliation-status.util.ts,
// not here - both this service and the repository need it, and this file
// already depends on the repository (constructor injection below), so
// putting the pure function here too would create a repository<->service
// circular import. Re-exported from there for anything importing this
// service's module for the status logic (e.g. tests).
export { computeReconciliationStatus } from "./stock-reconciliation-status.util.js";

/// Thin orchestration layer over the repository - exists so the controller
/// depends on a service (matching every other module's convention in this
/// codebase) rather than reaching into the repository directly, and so a
/// future aggregate/summary endpoint has one obvious place to live.
@Injectable()
export class StockReconciliationService {
  constructor(private readonly repository: StockReconciliationRepository) {}

  reconcilePage(query: StockReconciliationQuery): Promise<StockReconciliationPage> {
    return this.repository.reconcilePage(query);
  }

  findVariantsMissingStockItem(params: {
    warehouseId: string;
    page: number;
    pageSize: number;
  }) {
    return this.repository.findVariantsMissingStockItem(params);
  }

  /// Walks every page (bounded batch size, never loading the whole table at
  /// once) purely to produce status counts - a cheap "how many of each
  /// status right now" summary for an admin dashboard/scheduled audit log,
  /// without the caller having to paginate through the full detail list
  /// itself.
  async summarize(params: {
    variantId?: string;
    warehouseId?: string;
    batchSize?: number;
  }): Promise<StockReconciliationStatusCounts> {
    const pageSize = params.batchSize ?? 200;
    const byStatus: Record<ReconciliationStatus, number> = {
      CONSISTENT: 0,
      LOCAL_LEDGER_MISMATCH: 0,
      UNAS_BEHIND_PENDING_SYNC: 0,
      UNAS_MISMATCH_NO_PENDING_SYNC: 0,
      SYNC_FAILED: 0,
      PROCESSING_LEASE_EXPIRED: 0,
      MISSING_STOCK_ITEM: 0,
      MISSING_UNAS_LINK: 0,
      HISTORICAL_BASELINE_UNKNOWN: 0,
      INVALID_LEDGER_DATA: 0,
    };
    let checkedCount = 0;
    let page = 1;
    // Bounded loop: totalPages is re-read from the first page and never
    // exceeded, so a query that somehow never terminates (e.g. a buggy
    // count()) can't spin forever.
    let totalPages = 1;
    do {
      const result = await this.repository.reconcilePage({
        variantId: params.variantId,
        warehouseId: params.warehouseId,
        page,
        pageSize,
      });
      totalPages = result.totalPages;
      for (const row of result.items) {
        byStatus[row.status] += 1;
        checkedCount += 1;
      }
      page += 1;
    } while (page <= totalPages);

    return { checkedAt: new Date().toISOString(), checkedCount, byStatus };
  }
}
