import { Injectable } from "@nestjs/common";
import type {
  StockReconciliationReport,
  UnasApiOrder,
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
    const windowStart = cursor
      ? new Date(cursor.getTime() - OVERLAP_MS)
      : null;
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
      return { ...summary, stockMismatchCount: reconciliation.mismatches.length };
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
