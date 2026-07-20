import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { ConflictException } from "@nestjs/common";
import { prisma } from "@acropora/database";
import type { UnasApiCategory, UnasApiProduct } from "@acropora/types";

import type { UnasApiClient } from "./unas-api.client.js";
import { UnasProductCanonicalizer } from "./unas-product-canonicalizer.js";
import { UnasProductSyncDiffEngine } from "./unas-product-sync-diff.engine.js";
import { UnasProductSyncRepository } from "./unas-product-sync.repository.js";
import { UnasProductSyncService } from "./unas-product-sync.service.js";

const enabled = process.env.RUN_DB_INTEGRATION === "1";

const product = (sku: string): UnasApiProduct => ({
  externalId: "159850145",
  sku,
  name: "Integration Reef Pump",
  state: "live",
  externalStatus: "1",
  sourceCreatedAt: "2026-07-20T08:00:00.000Z",
  sourceUpdatedAt: "2026-07-20T09:00:00.000Z",
  descriptionShort: "Integration fixture",
  descriptionLong: null,
  descriptionShortIsHtml: false,
  descriptionLongIsHtml: null,
  unit: "db",
  secondaryUnit: "karton",
  secondaryUnitFactor: "12",
  manufacturerPartNumber: "INT-MPN-1",
  brandName: null,
  vatRate: "27",
  netPrice: "1000",
  grossPrice: "1270",
  saleNetPrice: null,
  saleGrossPrice: null,
  saleStartsAt: null,
  saleEndsAt: null,
  priceDisplay: "normal",
  minimumOrderQuantity: "1",
  maximumOrderQuantity: null,
  lowStockThreshold: "2",
  orderQuantityStep: "1",
  backorderAllowed: true,
  variantStockEnabled: false,
  reportedStock: "7.5",
  productUrl: "https://example.test/integration-pump",
  sefUrl: "integration-pump",
  manufacturerUrl: null,
  primaryCategoryExternalId: "10",
  alternativeCategoryExternalIds: [],
  images: [
    {
      type: "base",
      id: "1",
      sefUrl: "https://example.test/integration-pump.jpg",
      filename: "integration-pump.jpg",
      alt: "Integration pump",
    },
  ],
  parameters: [],
  seo: {
    title: "Integration pump",
    description: null,
    keywords: null,
    robots: null,
  },
  rawPayload: { Id: "159850145", Sku: sku },
});

const category: UnasApiCategory = {
  externalId: "10",
  name: "Integration pumps",
  state: "live",
  parentExternalId: null,
  sortOrder: 1,
  sourceCreatedAt: "2026-07-20T08:00:00.000Z",
  sourceUpdatedAt: "2026-07-20T09:00:00.000Z",
  rawPayload: { Id: "10", Name: "Integration pumps" },
};

async function cleanup() {
  await prisma.auditLog.deleteMany({
    where: { entityType: "ProductExtension" },
  });
  await prisma.domainEvent.deleteMany({
    where: { correlationId: { not: null } },
  });
  await prisma.integrationCursor.deleteMany({
    where: { provider: "UNAS", stream: "PRODUCTS" },
  });
  await prisma.unasProductSyncRun.deleteMany();
  await prisma.externalReference.deleteMany({ where: { system: "UNAS" } });
  await prisma.product.deleteMany();
  await prisma.category.deleteMany();
}

describe("UNAS Product Sync database integration", { skip: !enabled }, () => {
  let liveProducts = [product("INTEGRATION-SKU-1")];
  let deletedProducts: UnasApiProduct[] = [];
  const api = {
    getCategoryPage: async (_token: string, request: { limitStart: number }) =>
      request.limitStart === 0 ? [category] : [],
    getProductPage: async (
      _token: string,
      request: { limitStart: number; state?: "live" | "deleted" },
    ) => {
      if (request.limitStart !== 0) return [];
      return request.state === "deleted" ? deletedProducts : liveProducts;
    },
  } as unknown as UnasApiClient;
  const repository = new UnasProductSyncRepository();
  const service = new UnasProductSyncService(
    api,
    new UnasProductCanonicalizer(),
    new UnasProductSyncDiffEngine(),
    repository,
  );

  before(async () => {
    await cleanup();
  });

  after(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("creates a mirror, preserves extension and never writes inventory", async () => {
    const first = await service.runIncremental(
      "integration-token",
      new Date("2026-07-20T10:00:00.000Z"),
      100,
    );
    assert.equal(first.counts.CREATE, 1);
    const variant = await prisma.productVariant.findUniqueOrThrow({
      where: { sku: "INTEGRATION-SKU-1" },
      include: { product: { include: { unasSnapshot: true } } },
    });
    assert.equal(variant.product.mirrorSource, "UNAS");
    assert.equal(variant.product.mirrorState, "ACTIVE");
    assert.equal(
      variant.product.unasSnapshot?.reportedStock?.toString(),
      "7.5",
    );
    await prisma.productExtension.create({
      data: {
        variantId: variant.id,
        defaultPurchaseCurrency: "EUR",
        reorderPoint: "3",
      },
    });

    const eventCount = await prisma.domainEvent.count();
    const repeated = await service.runIncremental(
      "integration-token",
      new Date("2026-07-20T11:00:00.000Z"),
      100,
    );
    assert.equal(repeated.counts.UNCHANGED, 1);
    assert.equal(await prisma.domainEvent.count(), eventCount);
    assert.equal(await prisma.product.count(), 1);
    assert.equal(await prisma.stockMovement.count(), 0);
    assert.equal(await prisma.stockItem.count(), 0);
  });

  it("updates SKU by stable UNAS ID without replacing Acropora extension", async () => {
    liveProducts = [product("INTEGRATION-SKU-RENAMED")];
    const result = await service.runIncremental(
      "integration-token",
      new Date("2026-07-20T12:00:00.000Z"),
      100,
    );
    assert.equal(result.counts.UPDATE, 1);
    const variant = await prisma.productVariant.findUniqueOrThrow({
      where: { sku: "INTEGRATION-SKU-RENAMED" },
      include: { extension: true },
    });
    assert.equal(await prisma.product.count(), 1);
    assert.equal(variant.extension?.defaultPurchaseCurrency, "EUR");
    assert.equal(variant.extension?.reorderPoint?.toString(), "3");
  });

  it("marks an absent full-snapshot product missing and restores it", async () => {
    liveProducts = [];
    await prisma.integrationCursor.deleteMany({
      where: { provider: "UNAS", stream: "PRODUCTS" },
    });
    const missing = await service.runIncremental(
      "integration-token",
      new Date("2026-07-20T13:00:00.000Z"),
      100,
    );
    assert.equal(missing.missingCount, 1);
    assert.equal(
      (await prisma.product.findFirstOrThrow()).mirrorState,
      "MISSING",
    );

    liveProducts = [product("INTEGRATION-SKU-RENAMED")];
    const restored = await service.runIncremental(
      "integration-token",
      new Date("2026-07-20T14:00:00.000Z"),
      100,
    );
    assert.equal(restored.counts.UPDATE, 1);
    const productRecord = await prisma.product.findFirstOrThrow();
    assert.equal(productRecord.mirrorState, "ACTIVE");
    assert.equal(productRecord.missingSince, null);
    assert.equal(await prisma.productExtension.count(), 1);
  });

  it("rejects a concurrent run with a database-level conflict", async () => {
    const runId = await repository.createRun({
      kind: "INCREMENTAL",
      windowStart: new Date("2026-07-20T14:00:00.000Z"),
      windowEnd: new Date("2026-07-20T15:00:00.000Z"),
    });
    await assert.rejects(
      service.runIncremental(
        "integration-token",
        new Date("2026-07-20T15:00:00.000Z"),
        100,
      ),
      ConflictException,
    );
    await repository.markFailed(runId, "INTEGRATION_TEST_CLEANUP");
  });
});
