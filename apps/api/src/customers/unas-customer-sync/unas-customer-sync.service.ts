import { Injectable } from "@nestjs/common";
import type { UnasApiCustomer, UnasCustomerSyncSummary } from "@acropora/types";

import { UnasApiClient } from "../../imports/unas/unas-api.client.js";
import { UnasCustomerSyncRepository } from "./unas-customer-sync.repository.js";

// Mirrors UnasOrderSyncService's overlap window: re-checks a small slice
// before the last successful cursor so a customer modified right at the
// boundary of the previous run's windowEnd can't slip through unseen.
const OVERLAP_MS = 120_000;
const DEFAULT_PAGE_SIZE = 100;

@Injectable()
export class UnasCustomerSyncService {
  constructor(
    private readonly api: UnasApiClient,
    private readonly repository: UnasCustomerSyncRepository,
  ) {}

  async runIncremental(
    token: string,
    windowEnd = new Date(),
    pageSize = DEFAULT_PAGE_SIZE,
  ): Promise<UnasCustomerSyncSummary> {
    const cursor = await this.repository.getCursor();
    const windowStart = cursor
      ? new Date(cursor.getTime() - OVERLAP_MS)
      : null;
    const runId = await this.repository.createRun({ windowStart, windowEnd });
    try {
      const customers = await this.downloadCustomers(
        token,
        windowStart,
        windowEnd,
        pageSize,
      );
      return await this.repository.apply(runId, customers, windowStart, windowEnd);
    } catch (error) {
      const errorCode =
        error instanceof Error ? error.message : "UNAS_CUSTOMER_SYNC_FAILED";
      await this.repository.markFailed(runId, errorCode);
      throw error;
    }
  }

  private async downloadCustomers(
    token: string,
    windowStart: Date | null,
    windowEnd: Date,
    pageSize: number,
  ): Promise<UnasApiCustomer[]> {
    const byExternalId = new Map<string, UnasApiCustomer>();
    for (let limitStart = 0; ; limitStart += pageSize) {
      const page = await this.api.getCustomerPage(token, {
        modTimeStart: windowStart
          ? Math.floor(windowStart.getTime() / 1000)
          : undefined,
        modTimeEnd: Math.floor(windowEnd.getTime() / 1000),
        limitStart,
        limitNum: pageSize,
      });
      for (const customer of page) byExternalId.set(customer.externalId, customer);
      if (page.length < pageSize) break;
    }
    return [...byExternalId.values()];
  }
}
