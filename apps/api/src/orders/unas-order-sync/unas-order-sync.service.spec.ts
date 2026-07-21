import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UnasApiOrder } from "@acropora/types";

import type { UnasApiClient } from "../../imports/unas/unas-api.client.js";
import type { UnasOrderSyncRepository } from "./unas-order-sync.repository.js";
import { UnasOrderSyncService } from "./unas-order-sync.service.js";

function order(key: string): UnasApiOrder {
  return {
    key,
    internalKey: null,
    status: "open",
    statusType: "open_normal",
    statusId: "1",
    orderedAt: null,
    customerName: null,
    customerEmail: null,
    currency: "HUF",
    sumPriceGross: "1000",
    items: [],
  };
}

function fixture(input?: {
  cursor?: Date | null;
  pages?: UnasApiOrder[][];
  mismatchCount?: number;
}) {
  const calls: Array<{ operation: string; input?: unknown }> = [];
  const pages = [...(input?.pages ?? [[order("UN-1")], []])];
  const api = {
    getOrderPage: async (_token: string, request: unknown) => {
      calls.push({ operation: "page", input: request });
      return pages.shift() ?? [];
    },
  } as unknown as UnasApiClient;
  const repository = {
    getCursor: async () => input?.cursor ?? null,
    createRun: async (run: unknown) => {
      calls.push({ operation: "createRun", input: run });
      return "run-1";
    },
    apply: async (
      _runId: string,
      orders: UnasApiOrder[],
      windowStart: Date | null,
      windowEnd: Date,
    ) => {
      calls.push({ operation: "apply", input: orders });
      return {
        runId: "run-1",
        status: "APPLIED" as const,
        ordersSeen: orders.length,
        createdCount: orders.length,
        updatedCount: 0,
        reversedCount: 0,
        stockMismatchCount: 0,
        windowStart: windowStart?.toISOString() ?? null,
        windowEnd: windowEnd.toISOString(),
      };
    },
    findStockDiscrepancies: async () => {
      calls.push({ operation: "reconciliation" });
      return {
        checkedAt: new Date().toISOString(),
        checkedCount: 5,
        mismatches: Array.from({ length: input?.mismatchCount ?? 0 }, () => ({
          variantId: "v",
          sku: "sku",
          productName: "name",
          localOnHand: "1",
          unasReportedStock: "2",
          difference: "-1",
          reportedStockSyncedAt: null,
        })),
      };
    },
    recordStockMismatchCount: async (runId: string, count: number) => {
      calls.push({ operation: "recordMismatch", input: { runId, count } });
    },
    markFailed: async (_runId: string, errorCode: string) => {
      calls.push({ operation: "failed", input: errorCode });
    },
  } as unknown as UnasOrderSyncRepository;
  return { service: new UnasOrderSyncService(api, repository), calls };
}

describe("UnasOrderSyncService.runIncremental", () => {
  it("uses an overlapped cursor window, paginates until a short page, and records the reconciliation count", async () => {
    const cursor = new Date("2026-07-21T12:00:00.000Z");
    const windowEnd = new Date("2026-07-21T13:00:00.000Z");
    const { service, calls } = fixture({
      cursor,
      pages: [[order("UN-1"), order("UN-2")], [order("UN-2")]],
      mismatchCount: 2,
    });

    const result = await service.runIncremental("token", windowEnd, 2);

    assert.equal(result.ordersSeen, 2);
    assert.equal(result.stockMismatchCount, 2);
    const pageRequests = calls.filter((call) => call.operation === "page");
    assert.equal(pageRequests.length, 2);
    assert.equal(
      (pageRequests[0]!.input as { timeModStart: number }).timeModStart,
      Math.floor((cursor.getTime() - 120_000) / 1000),
    );
    assert.equal(calls.some((call) => call.operation === "apply"), true);
    assert.equal(
      calls.some((call) => call.operation === "recordMismatch"),
      true,
    );
  });

  it("deduplicates orders seen across pages by their UNAS Key", async () => {
    const { service, calls } = fixture({
      pages: [[order("UN-1")], [order("UN-1")]],
    });
    const result = await service.runIncremental("token", new Date(), 1);
    assert.equal(result.ordersSeen, 1);
    const applyCall = calls.find((call) => call.operation === "apply");
    assert.equal((applyCall?.input as UnasApiOrder[]).length, 1);
  });

  it("marks the run failed and skips reconciliation when the download throws", async () => {
    const calls: Array<{ operation: string; input?: unknown }> = [];
    const api = {
      getOrderPage: async () => {
        throw new Error("UNAS_DOWN");
      },
    } as unknown as UnasApiClient;
    const repository = {
      getCursor: async () => null,
      createRun: async () => "run-1",
      apply: async () => {
        calls.push({ operation: "apply" });
        return {};
      },
      findStockDiscrepancies: async () => {
        calls.push({ operation: "reconciliation" });
        return { checkedAt: "", checkedCount: 0, mismatches: [] };
      },
      recordStockMismatchCount: async () => {},
      markFailed: async (_runId: string, errorCode: string) => {
        calls.push({ operation: "failed", input: errorCode });
      },
    } as unknown as UnasOrderSyncRepository;
    const service = new UnasOrderSyncService(api, repository);

    await assert.rejects(
      service.runIncremental("token", new Date(), 10),
      /UNAS_DOWN/,
    );
    assert.equal(calls.some((call) => call.operation === "apply"), false);
    assert.equal(
      calls.some((call) => call.operation === "reconciliation"),
      false,
    );
    assert.equal(calls.at(-1)?.operation, "failed");
  });
});
