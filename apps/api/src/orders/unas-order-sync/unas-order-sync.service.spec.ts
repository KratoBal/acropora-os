import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NotFoundException } from "@nestjs/common";
import type { UnasApiOrder, UnasOrderDetail } from "@acropora/types";

import {
  UnasApiError,
  type UnasApiClient,
  type UnasApiErrorCode,
} from "../../imports/unas/unas-api.client.js";
import type { UnasOrderSyncRepository } from "./unas-order-sync.repository.js";
import type { UnasStockSyncOutboxService } from "../../inventory/unas-stock-sync-outbox.service.js";
import { UnasOrderSyncService } from "./unas-order-sync.service.js";

function order(key: string): UnasApiOrder {
  return {
    key,
    id: `id-${key}`,
    internalKey: null,
    status: "open",
    statusType: "open_normal",
    statusId: "1",
    orderedAt: null,
    customerName: null,
    customerEmail: null,
    buyerInvoiceName: null,
    buyerTaxNumber: null,
    buyerEuTaxNumber: null,
    buyerCustomerType: null,
    buyerCountryCode: null,
    buyerZip: null,
    buyerCity: null,
    buyerAddress: null,
    currency: "HUF",
    sumPriceGross: "1000",
    paymentName: null,
    paymentType: null,
    paymentStatus: null,
    shippingName: null,
    couponCode: null,
    invoiceStatus: null,
    invoiceNumber: null,
    invoiceUrl: null,
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
  const stockPublisher = {
    processForUnasOrder: async () => ({
      claimed: 0,
      succeeded: 0,
      superseded: 0,
      retried: 0,
      deadLettered: 0,
    }),
  } as unknown as UnasStockSyncOutboxService;
  return {
    service: new UnasOrderSyncService(api, repository, stockPublisher),
    calls,
  };
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
    assert.equal(
      calls.some((call) => call.operation === "apply"),
      true,
    );
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
    const service = new UnasOrderSyncService(api, repository, {
      processForUnasOrder: async () => ({
        claimed: 0,
        succeeded: 0,
        superseded: 0,
        retried: 0,
        deadLettered: 0,
      }),
    } as unknown as UnasStockSyncOutboxService);

    await assert.rejects(
      service.runIncremental("token", new Date(), 10),
      /UNAS_DOWN/,
    );
    assert.equal(
      calls.some((call) => call.operation === "apply"),
      false,
    );
    assert.equal(
      calls.some((call) => call.operation === "reconciliation"),
      false,
    );
    assert.equal(calls.at(-1)?.operation, "failed");
  });
});

function detail(overrides: Partial<UnasOrderDetail> = {}): UnasOrderDetail {
  return {
    id: "order-1",
    orderNumber: "UNAS-UN-1",
    status: "CONFIRMED",
    unasStatusLabel: null,
    buyerName: "Kovács Anna",
    buyerEmail: "vevo@example.com",
    paymentName: null,
    paymentStatus: null,
    shippingName: null,
    currency: "HUF",
    totalNet: "1000",
    totalTax: "270",
    totalGross: "1270",
    orderedAt: null,
    createdAt: "2026-07-20T14:05:00.000Z",
    unasDeletedAt: null,
    lines: [],
    unasInvoiceStatus: null,
    invoices: [],
    ...overrides,
  };
}

describe("UnasOrderSyncService.refreshOrder", () => {
  function fixture(input?: {
    key?: string | null;
    fetchedOrder?: UnasApiOrder | null;
    detailAfterRefresh?: UnasOrderDetail | null;
    reconcileResult?: { reversed: boolean; alreadyReconciled: boolean };
  }) {
    const calls: Array<{ operation: string; input?: unknown }> = [];
    const api = {
      getOrderByKey: async (_token: string, key: string) => {
        calls.push({ operation: "getOrderByKey", input: key });
        return input?.fetchedOrder === undefined
          ? order("UN-1")
          : input.fetchedOrder;
      },
    } as unknown as UnasApiClient;
    const repository = {
      getUnasKey: async (orderId: string) => {
        calls.push({ operation: "getUnasKey", input: orderId });
        return input?.key === undefined ? "UN-1" : input.key;
      },
      refreshOrder: async (orderId: string, fetched: UnasApiOrder) => {
        calls.push({ operation: "refreshOrder", input: { orderId, fetched } });
        return { updated: true, reversed: false };
      },
      reconcileDeletedOrder: async (orderId: string, unasKey: string) => {
        calls.push({
          operation: "reconcileDeletedOrder",
          input: { orderId, unasKey },
        });
        return (
          input?.reconcileResult ?? { reversed: true, alreadyReconciled: false }
        );
      },
      findById: async (orderId: string) => {
        calls.push({ operation: "findById", input: orderId });
        return input?.detailAfterRefresh === undefined
          ? detail({ id: orderId })
          : input.detailAfterRefresh;
      },
    } as unknown as UnasOrderSyncRepository;
    const stockPublisher = {
      processForUnasOrder: async (orderId: string, token: string) => {
        calls.push({
          operation: "processForUnasOrder",
          input: { orderId, token },
        });
        return {
          claimed: 1,
          succeeded: 1,
          superseded: 0,
          retried: 0,
          deadLettered: 0,
        };
      },
    } as unknown as UnasStockSyncOutboxService;
    return {
      service: new UnasOrderSyncService(api, repository, stockPublisher),
      calls,
    };
  }

  it("fetches only the targeted order by its UNAS Key, refreshes it, and returns the freshly re-read detail", async () => {
    const { service, calls } = fixture();

    const result = await service.refreshOrder("token", "order-1");

    assert.equal(
      calls.map((call) => call.operation).join(","),
      "getUnasKey,getOrderByKey,refreshOrder,findById,processForUnasOrder",
    );
    assert.equal(
      calls.find((call) => call.operation === "getOrderByKey")?.input,
      "UN-1",
    );
    assert.equal(result.id, "order-1");
    assert.equal(result.stockPublish.succeeded, 1);
    assert.deepEqual(
      calls.find((call) => call.operation === "processForUnasOrder")?.input,
      { orderId: "order-1", token: "token" },
    );
  });

  it("throws 404 when the order was never UNAS-synced (no Key on file), and never touches UNAS or stock for a locally-nonexistent order id (#13)", async () => {
    const { service, calls } = fixture({ key: null });

    await assert.rejects(
      () => service.refreshOrder("token", "does-not-exist-locally"),
      (error) => error instanceof NotFoundException,
    );
    // Business rule 3/4: a targeted lookup that never even reaches UNAS
    // (because the order isn't known locally in the first place) must
    // never be treated as a confirmed deletion - reconcileDeletedOrder
    // must not run, and the UNAS API must never be called.
    assert.equal(calls.map((call) => call.operation).join(","), "getUnasKey");
  });

  const transientErrorCodes: UnasApiErrorCode[] = [
    "NETWORK_FAILED",
    "TIMEOUT",
    "AUTH_REJECTED",
    "HTTP_4XX",
    "RATE_LIMITED",
    "HTTP_5XX",
    "RESPONSE_SHAPE_INVALID",
  ];
  for (const code of transientErrorCodes) {
    it(`propagates a ${code} UnasApiError without treating it as a deletion (#11) - order/stock must stay unmodified`, async () => {
      const calls: Array<{ operation: string; input?: unknown }> = [];
      const api = {
        getOrderByKey: async () => {
          calls.push({ operation: "getOrderByKey" });
          throw new UnasApiError(code);
        },
      } as unknown as UnasApiClient;
      const repository = {
        getUnasKey: async () => "UN-1",
        reconcileDeletedOrder: async () => {
          calls.push({ operation: "reconcileDeletedOrder" });
          return { reversed: true, alreadyReconciled: false };
        },
      } as unknown as UnasOrderSyncRepository;
      const service = new UnasOrderSyncService(api, repository, {
        processForUnasOrder: async () => {
          calls.push({ operation: "processForUnasOrder" });
          return {
            claimed: 0,
            succeeded: 0,
            superseded: 0,
            retried: 0,
            deadLettered: 0,
          };
        },
      } as unknown as UnasStockSyncOutboxService);

      await assert.rejects(
        () => service.refreshOrder("token", "order-1"),
        (error) => error instanceof UnasApiError && error.code === code,
      );
      assert.equal(
        calls.some((call) => call.operation === "reconcileDeletedOrder"),
        false,
      );
    });
  }

  it("reconciles a physical UNAS deletion instead of throwing a generic 404 when UNAS confirms the order is gone", async () => {
    const { service, calls } = fixture({ fetchedOrder: null });

    const result = await service.refreshOrder("token", "order-1");

    assert.equal(
      calls.map((call) => call.operation).join(","),
      "getUnasKey,getOrderByKey,reconcileDeletedOrder,findById,processForUnasOrder",
    );
    assert.deepEqual(
      calls.find((call) => call.operation === "reconcileDeletedOrder")?.input,
      { orderId: "order-1", unasKey: "UN-1" },
    );
    assert.equal(result.id, "order-1");
  });

  it("throws 404 if the order can no longer be found locally after applying the refresh", async () => {
    const { service } = fixture({ detailAfterRefresh: null });

    await assert.rejects(
      () => service.refreshOrder("token", "order-1"),
      (error) => error instanceof NotFoundException,
    );
  });

  it("throws 404 if the order can no longer be found locally after a deletion reconciliation", async () => {
    const { service } = fixture({
      fetchedOrder: null,
      detailAfterRefresh: null,
    });

    await assert.rejects(
      () => service.refreshOrder("token", "order-1"),
      (error) => error instanceof NotFoundException,
    );
  });
});
