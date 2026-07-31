import { Injectable, NotFoundException } from "@nestjs/common";
import type {
  StockReconciliationReport,
  UnasApiOrder,
  UnasOrderDetail,
  UnasOrderSyncSummary,
} from "@acropora/types";

import { UnasApiClient } from "../../imports/unas/unas-api.client.js";
import { UnasOrderSyncRepository } from "./unas-order-sync.repository.js";

// Mirrors UnasProductSyncService's overlap window: re-checks a small slice
// before the last successful cursor so an order modified right at the
// boundary of the previous run's windowEnd can't slip through unseen.
const OVERLAP_MS = 120_000;
const DEFAULT_PAGE_SIZE = 500;

@Injectable()
export class UnasOrderSyncService {
  constructor(
    private readonly api: UnasApiClient,
    private readonly repository: UnasOrderSyncRepository,
  ) {}

  async runIncremental(
    token: string,
    windowEnd = new Date(),
    pageSize = DEFAULT_PAGE_SIZE,
  ): Promise<UnasOrderSyncSummary> {
    const cursor = await this.repository.getCursor();
    const windowStart = cursor ? new Date(cursor.getTime() - OVERLAP_MS) : null;
    const runId = await this.repository.createRun({ windowStart, windowEnd });
    try {
      const orders = await this.downloadOrders(
        token,
        windowStart,
        windowEnd,
        pageSize,
      );
      const summary = await this.repository.apply(
        runId,
        orders,
        windowStart,
        windowEnd,
      );
      // Deliberately outside the order-processing transaction: a pure,
      // read-only comparison against data the product sync job already
      // keeps fresh, so its cost/correctness never affects whether orders
      // were applied successfully.
      const reconciliation = await this.repository.findStockDiscrepancies();
      await this.repository.recordStockMismatchCount(
        runId,
        reconciliation.mismatches.length,
      );
      return {
        ...summary,
        stockMismatchCount: reconciliation.mismatches.length,
      };
    } catch (error) {
      const errorCode =
        error instanceof Error ? error.message : "UNAS_ORDER_SYNC_FAILED";
      await this.repository.markFailed(runId, errorCode);
      throw error;
    }
  }

  checkStockReconciliation(): Promise<StockReconciliationReport> {
    return this.repository.findStockDiscrepancies();
  }

  /// Manual single-order refresh (see the order-detail page's "Rendelés
  /// frissítése" button): fetches exactly one order from UNAS by its own
  /// Key - never a time-window/batch page, and never touches the general
  /// incremental sync's cursor or run bookkeeping (both are only ever
  /// written by runIncremental -> repository.apply()). Reuses
  /// applyExistingOrderUpdate via repository.refreshOrder() so status
  /// transitions, stock reversal, invoice mirroring, and technical-cost-line
  /// correction all behave identically to a batch sighting of the same
  /// order.
  async refreshOrder(token: string, orderId: string): Promise<UnasOrderDetail> {
    const key = await this.repository.getUnasKey(orderId);
    if (!key)
      throw new NotFoundException(
        "Ehhez a rendeléshez nem tartozik UNAS-azonosító.",
      );
    const order = await this.api.getOrderByKey(token, key);
    if (!order) {
      // getOrderByKey returns null ONLY for a well-formed UNAS response
      // that genuinely contains no matching order for this exact Key (see
      // that method's own doc comment) - every other outcome (network
      // failure, timeout, 401/403, 429, 5xx, malformed response) throws
      // UnasApiError instead and never reaches this branch. This IS the
      // "targeted, single-order lookup confirms NOT_FOUND" proof business
      // rule 4 requires before anything is allowed to be treated as a
      // physical UNAS deletion - so, unlike before, this no longer ends in
      // a plain 404: it starts the same reconciliation the automatic
      // worker uses (reconcileDeletedOrder), reverses whatever net stock
      // is still booked out, marks the local order accordingly, and
      // returns 200 with its (now-flagged) detail - never a 404 - per
      // business rule 3's explicit UI requirement.
      await this.repository.reconcileDeletedOrder(orderId, key);
      const detail = await this.repository.findById(orderId);
      if (!detail) throw new NotFoundException("A rendelés nem található.");
      return detail;
    }
    await this.repository.refreshOrder(orderId, order);
    const detail = await this.repository.findById(orderId);
    if (!detail) throw new NotFoundException("A rendelés nem található.");
    return detail;
  }

  private async downloadOrders(
    token: string,
    windowStart: Date | null,
    windowEnd: Date,
    pageSize: number,
  ): Promise<UnasApiOrder[]> {
    const byKey = new Map<string, UnasApiOrder>();
    for (let limitStart = 0; ; limitStart += pageSize) {
      const page = await this.api.getOrderPage(token, {
        timeModStart: windowStart
          ? Math.floor(windowStart.getTime() / 1000)
          : undefined,
        timeModEnd: Math.floor(windowEnd.getTime() / 1000),
        limitStart,
        limitNum: pageSize,
      });
      for (const order of page) byKey.set(order.key, order);
      if (page.length < pageSize) break;
    }
    return [...byKey.values()];
  }
}
