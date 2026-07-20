import { Injectable } from "@nestjs/common";
import type {
  CanonicalUnasProduct,
  UnasApiCategory,
  UnasProductSyncSummary,
} from "@acropora/types";

import { UnasApiClient } from "./unas-api.client.js";
import { UnasProductCanonicalizer } from "./unas-product-canonicalizer.js";
import { UnasProductSyncDiffEngine } from "./unas-product-sync-diff.engine.js";
import { UnasProductSyncRepository } from "./unas-product-sync.repository.js";

const OVERLAP_MS = 120_000;
const DEFAULT_PAGE_SIZE = 500;

@Injectable()
export class UnasProductSyncService {
  constructor(
    private readonly api: UnasApiClient,
    private readonly canonicalizer: UnasProductCanonicalizer,
    private readonly diffEngine: UnasProductSyncDiffEngine,
    private readonly repository: UnasProductSyncRepository,
  ) {}

  async runIncremental(
    token: string,
    windowEnd = new Date(),
    pageSize = DEFAULT_PAGE_SIZE,
  ): Promise<UnasProductSyncSummary> {
    const cursor = await this.repository.getCursor();
    const windowStart = cursor ? new Date(cursor.getTime() - OVERLAP_MS) : null;
    const runId = await this.repository.createRun({
      kind: cursor ? "INCREMENTAL" : "FULL",
      windowStart,
      windowEnd,
    });
    try {
      const categories = await this.downloadCategories(
        runId,
        token,
        windowStart,
        windowEnd,
        pageSize,
      );
      const products = await this.downloadProducts(
        runId,
        token,
        windowStart,
        windowEnd,
        pageSize,
        "live",
      );
      const deletedProducts = await this.downloadProducts(
        runId,
        token,
        windowStart,
        windowEnd,
        pageSize,
        "deleted",
      );
      this.assertUniqueSourceIdentity(products);
      const snapshots = await this.repository.identitySnapshots();
      const diffs = this.diffEngine.diff(products, snapshots);
      if (diffs.some((diff) => diff.action === "CONFLICT"))
        throw new Error("UNAS_PRODUCT_IDENTITY_CONFLICT");
      return await this.repository.apply(
        runId,
        diffs,
        windowStart,
        windowEnd,
        categories,
        deletedProducts.map((product) => product.externalId),
      );
    } catch (error) {
      const errorCode =
        error instanceof Error ? error.message : "UNAS_PRODUCT_SYNC_FAILED";
      await this.repository.markFailed(runId, errorCode);
      throw error;
    }
  }

  private async downloadProducts(
    runId: string,
    token: string,
    windowStart: Date | null,
    windowEnd: Date,
    pageSize: number,
    state: "live" | "deleted",
  ) {
    const byId = new Map<string, CanonicalUnasProduct>();
    for (let limitStart = 0; ; limitStart += pageSize) {
      const page = await this.api.getProductPage(token, {
        timeStart: windowStart
          ? Math.floor(windowStart.getTime() / 1000)
          : undefined,
        timeEnd: Math.floor(windowEnd.getTime() / 1000),
        limitStart,
        limitNum: pageSize,
        state,
        contentType: "full",
      });
      for (const item of page) {
        const product = this.canonicalizer.canonicalize(item);
        const previous = byId.get(product.externalId);
        if (previous && previous.canonicalHash !== product.canonicalHash)
          throw new Error("DUPLICATE_UNAS_ID_WITH_DIFFERENT_PAYLOAD");
        byId.set(product.externalId, product);
      }
      await this.repository.heartbeat(runId);
      if (page.length < pageSize) break;
    }
    return [...byId.values()];
  }

  private async downloadCategories(
    runId: string,
    token: string,
    windowStart: Date | null,
    windowEnd: Date,
    pageSize: number,
  ): Promise<UnasApiCategory[]> {
    const byId = new Map<string, UnasApiCategory>();
    for (let limitStart = 0; ; limitStart += pageSize) {
      const page = await this.api.getCategoryPage(token, {
        timeStart: windowStart
          ? Math.floor(windowStart.getTime() / 1000)
          : undefined,
        timeEnd: Math.floor(windowEnd.getTime() / 1000),
        limitStart,
        limitNum: pageSize,
        contentType: "normal",
      });
      for (const category of page) byId.set(category.externalId, category);
      await this.repository.heartbeat(runId);
      if (page.length < pageSize) break;
    }
    return [...byId.values()];
  }

  private assertUniqueSourceIdentity(
    products: readonly CanonicalUnasProduct[],
  ) {
    const skuToId = new Map<string, string>();
    for (const product of products) {
      const existingId = skuToId.get(product.sku);
      if (existingId && existingId !== product.externalId)
        throw new Error("DUPLICATE_UNAS_SKU");
      skuToId.set(product.sku, product.externalId);
    }
  }
}
