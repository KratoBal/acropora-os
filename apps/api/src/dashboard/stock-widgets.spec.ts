import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { StockReconciliationService } from "../inventory/stock-reconciliation.service.js";
import type { UnasStockSyncOutboxRepository } from "../inventory/unas-stock-sync-outbox.repository.js";
import {
  DISCREPANCY_STATUSES,
  stockDiscrepancies,
  stockSyncOutboxState,
} from "./stock-widgets.js";

describe("Készlet-egyeztetés", () => {
  it("counts and lists only the actionable statuses", async () => {
    const byStatus = {
      CONSISTENT: 100,
      LOCAL_LEDGER_MISMATCH: 2,
      UNAS_BEHIND_PENDING_SYNC: 7, // a fix is queued: not actionable
      UNAS_MISMATCH_NO_PENDING_SYNC: 1,
      SYNC_FAILED: 0,
      PROCESSING_LEASE_EXPIRED: 0,
      MISSING_STOCK_ITEM: 0,
      MISSING_UNAS_LINK: 5, // a warning
      HISTORICAL_BASELINE_UNKNOWN: 9, // a warning
      INVALID_LEDGER_DATA: 0,
    };
    const item = (sku: string, status: string) => ({
      variantId: `v-${sku}`,
      sku,
      warehouseCode: "KIT",
      status,
    });
    const reconciliation = {
      summarize: async () => ({ byStatus }),
      reconcilePage: async () => ({
        items: [
          item("A", "CONSISTENT"),
          item("B", "LOCAL_LEDGER_MISMATCH"),
          item("C", "UNAS_BEHIND_PENDING_SYNC"),
          item("D", "UNAS_MISMATCH_NO_PENDING_SYNC"),
        ],
      }),
    } as unknown as StockReconciliationService;

    const data = await stockDiscrepancies(reconciliation);
    assert.equal(data.count, 3);
    assert.deepEqual(
      data.items.map((i) => i.sku),
      ["B", "D"],
    );
    assert.ok(!DISCREPANCY_STATUSES.has("UNAS_BEHIND_PENDING_SYNC"));
  });
});

describe("Készlet-kimenősor (read only)", () => {
  it("shows queued, retrying, dead-letter and the last success; never the successful rows", async () => {
    const outbox = new Proxy(
      {
        countsByStatus: async () => ({
          PENDING: 3,
          PROCESSING: 1,
          SUCCEEDED: 900,
          FAILED: 2,
          DEAD_LETTER: 1,
        }),
        lastSuccessfulPublishAt: async () => new Date("2026-10-02T05:00:00Z"),
      },
      {
        get(target, name: string) {
          if (name in target) return target[name as keyof typeof target];
          // any other repository method (a write, a retry) would be a violation
          throw new Error(`the dashboard must not call outbox.${name}`);
        },
      },
    ) as unknown as UnasStockSyncOutboxRepository;

    assert.deepEqual(await stockSyncOutboxState(outbox), {
      queued: 4,
      retrying: 2,
      deadLetter: 1,
      lastSuccessfulSyncAt: "2026-10-02T05:00:00.000Z",
    });
  });

  it("no success yet: null, not a made-up time", async () => {
    const outbox = {
      countsByStatus: async () => ({
        PENDING: 0,
        PROCESSING: 0,
        SUCCEEDED: 0,
        FAILED: 0,
        DEAD_LETTER: 0,
      }),
      lastSuccessfulPublishAt: async () => null,
    } as unknown as UnasStockSyncOutboxRepository;
    assert.equal(
      (await stockSyncOutboxState(outbox)).lastSuccessfulSyncAt,
      null,
    );
  });
});
