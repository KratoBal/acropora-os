import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { UnasApiProduct } from "@acropora/types";

import type { UnasApiClient } from "./unas-api.client.js";
import { UnasProductCanonicalizer } from "./unas-product-canonicalizer.js";
import { UnasProductSyncDiffEngine } from "./unas-product-sync-diff.engine.js";
import type { UnasProductSyncRepository } from "./unas-product-sync.repository.js";
import { UnasProductSyncService } from "./unas-product-sync.service.js";

const product = (externalId: string, sku: string): UnasApiProduct => ({
  externalId,
  sku,
  name: `Product ${externalId}`,
  state: "live",
  externalStatus: "1",
  sourceCreatedAt: "2026-07-20T10:00:00.000Z",
  sourceUpdatedAt: "2026-07-20T11:00:00.000Z",
  descriptionShort: null,
  descriptionLong: null,
  descriptionShortIsHtml: null,
  descriptionLongIsHtml: null,
  unit: "db",
  secondaryUnit: null,
  secondaryUnitFactor: null,
  manufacturerPartNumber: null,
  brandName: null,
  vatRate: null,
  netPrice: null,
  grossPrice: null,
  saleNetPrice: null,
  saleGrossPrice: null,
  saleStartsAt: null,
  saleEndsAt: null,
  priceDisplay: null,
  minimumOrderQuantity: null,
  maximumOrderQuantity: null,
  lowStockThreshold: null,
  orderQuantityStep: null,
  backorderAllowed: null,
  variantStockEnabled: null,
  reportedStock: null,
  productUrl: null,
  sefUrl: null,
  manufacturerUrl: null,
  primaryCategoryExternalId: null,
  alternativeCategoryExternalIds: [],
  images: [],
  parameters: [],
  seo: { title: null, description: null, keywords: null, robots: null },
  rawPayload: { Id: externalId, Sku: sku },
});

function fixture(input?: {
  cursor?: Date | null;
  pages?: UnasApiProduct[][];
  snapshots?: Array<{
    productId: string;
    externalId: string;
    sku: string;
    canonicalHash: string | null;
  }>;
}) {
  const calls: Array<{ operation: string; input?: unknown }> = [];
  const pages = [...(input?.pages ?? [[product("1", "SKU-1")], []])];
  const api = {
    getCategoryPage: async (_token: string, request: unknown) => {
      calls.push({ operation: "categoryPage", input: request });
      return [];
    },
    getProductPage: async (_token: string, request: unknown) => {
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
    identitySnapshots: async () => input?.snapshots ?? [],
    heartbeat: async (runId: string) => {
      calls.push({ operation: "heartbeat", input: runId });
    },
    apply: async (
      _runId: string,
      diffs: Array<{ action: string }>,
      windowStart: Date | null,
      windowEnd: Date,
    ) => {
      calls.push({ operation: "apply", input: diffs });
      return {
        runId: "run-1",
        status: "APPLIED" as const,
        productsSeen: diffs.length,
        counts: {
          CREATE: diffs.filter((item) => item.action === "CREATE").length,
          UPDATE: 0,
          UNCHANGED: 0,
          CONFLICT: 0,
        },
        missingCount: 0,
        windowStart: windowStart?.toISOString() ?? null,
        windowEnd: windowEnd.toISOString(),
      };
    },
    markFailed: async (_runId: string, errorCode: string) => {
      calls.push({ operation: "failed", input: errorCode });
    },
  } as unknown as UnasProductSyncRepository;
  return {
    service: new UnasProductSyncService(
      api,
      new UnasProductCanonicalizer(),
      new UnasProductSyncDiffEngine(),
      repository,
    ),
    calls,
  };
}

describe("UnasProductSyncService", () => {
  it("uses an overlapped cursor window and applies all pages once", async () => {
    const cursor = new Date("2026-07-20T12:00:00.000Z");
    const windowEnd = new Date("2026-07-20T13:00:00.000Z");
    const { service, calls } = fixture({
      cursor,
      pages: [
        [product("1", "SKU-1"), product("2", "SKU-2")],
        [product("2", "SKU-2")],
      ],
    });
    const result = await service.runIncremental("token", windowEnd, 2);

    assert.equal(result.productsSeen, 2);
    const pageRequests = calls.filter(
      (call) =>
        call.operation === "page" &&
        (call.input as { state: string }).state === "live",
    );
    assert.equal(pageRequests.length, 2);
    assert.equal(
      (pageRequests[0]!.input as { timeStart: number }).timeStart,
      Math.floor((cursor.getTime() - 120_000) / 1000),
    );
    assert.equal(
      calls.some(
        (call) =>
          call.operation === "page" &&
          (call.input as { state: string }).state === "deleted",
      ),
      true,
    );
    assert.equal(calls.at(-1)?.operation, "apply");
  });

  it("marks the run failed and never applies duplicate source SKUs", async () => {
    const { service, calls } = fixture({
      pages: [[product("1", "DUP"), product("2", "DUP")]],
    });
    await assert.rejects(
      service.runIncremental("token", new Date(), 10),
      /DUPLICATE_UNAS_SKU/,
    );
    assert.equal(
      calls.some((call) => call.operation === "apply"),
      false,
    );
    assert.equal(calls.at(-1)?.operation, "failed");
  });

  it("does not apply an external ID and SKU cross-record conflict", async () => {
    const { service, calls } = fixture({
      pages: [[product("1", "SKU-X")]],
      snapshots: [
        {
          productId: "by-id",
          externalId: "1",
          sku: "OLD",
          canonicalHash: null,
        },
        {
          productId: "by-sku",
          externalId: "2",
          sku: "SKU-X",
          canonicalHash: null,
        },
      ],
    });
    await assert.rejects(
      service.runIncremental("token", new Date(), 10),
      /UNAS_PRODUCT_IDENTITY_CONFLICT/,
    );
    assert.equal(
      calls.some((call) => call.operation === "apply"),
      false,
    );
    assert.equal(calls.at(-1)?.operation, "failed");
  });
});
