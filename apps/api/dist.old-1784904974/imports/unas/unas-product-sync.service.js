var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Injectable } from "@nestjs/common";
import { UnasApiClient } from "./unas-api.client.js";
import { UnasProductCanonicalizer } from "./unas-product-canonicalizer.js";
import { UnasProductSyncDiffEngine } from "./unas-product-sync-diff.engine.js";
import { UnasProductSyncRepository } from "./unas-product-sync.repository.js";
const OVERLAP_MS = 120_000;
const DEFAULT_PAGE_SIZE = 500;
let UnasProductSyncService = class UnasProductSyncService {
    api;
    canonicalizer;
    diffEngine;
    repository;
    constructor(api, canonicalizer, diffEngine, repository) {
        this.api = api;
        this.canonicalizer = canonicalizer;
        this.diffEngine = diffEngine;
        this.repository = repository;
    }
    async runIncremental(token, windowEnd = new Date(), pageSize = DEFAULT_PAGE_SIZE) {
        const cursor = await this.repository.getCursor();
        const windowStart = cursor ? new Date(cursor.getTime() - OVERLAP_MS) : null;
        const runId = await this.repository.createRun({
            kind: cursor ? "INCREMENTAL" : "FULL",
            windowStart,
            windowEnd,
        });
        try {
            const categories = await this.downloadCategories(runId, token, windowStart, windowEnd, pageSize);
            const products = await this.downloadProducts(runId, token, windowStart, windowEnd, pageSize, "live");
            const deletedProducts = await this.downloadProducts(runId, token, windowStart, windowEnd, pageSize, "deleted");
            this.assertUniqueSourceIdentity(products);
            const snapshots = await this.repository.identitySnapshots();
            const diffs = this.diffEngine.diff(products, snapshots);
            if (diffs.some((diff) => diff.action === "CONFLICT"))
                throw new Error("UNAS_PRODUCT_IDENTITY_CONFLICT");
            return await this.repository.apply(runId, diffs, windowStart, windowEnd, categories, deletedProducts.map((product) => product.externalId));
        }
        catch (error) {
            const errorCode = error instanceof Error ? error.message : "UNAS_PRODUCT_SYNC_FAILED";
            await this.repository.markFailed(runId, errorCode);
            throw error;
        }
    }
    async downloadProducts(runId, token, windowStart, windowEnd, pageSize, state) {
        const byId = new Map();
        for (let limitStart = 0;; limitStart += pageSize) {
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
            if (page.length < pageSize)
                break;
        }
        return [...byId.values()];
    }
    async downloadCategories(runId, token, windowStart, windowEnd, pageSize) {
        const byId = new Map();
        for (let limitStart = 0;; limitStart += pageSize) {
            const page = await this.api.getCategoryPage(token, {
                timeStart: windowStart
                    ? Math.floor(windowStart.getTime() / 1000)
                    : undefined,
                timeEnd: Math.floor(windowEnd.getTime() / 1000),
                limitStart,
                limitNum: pageSize,
                contentType: "normal",
            });
            for (const category of page)
                byId.set(category.externalId, category);
            await this.repository.heartbeat(runId);
            if (page.length < pageSize)
                break;
        }
        return [...byId.values()];
    }
    assertUniqueSourceIdentity(products) {
        const skuToId = new Map();
        for (const product of products) {
            const existingId = skuToId.get(product.sku);
            if (existingId && existingId !== product.externalId)
                throw new Error("DUPLICATE_UNAS_SKU");
            skuToId.set(product.sku, product.externalId);
        }
    }
};
UnasProductSyncService = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [UnasApiClient,
        UnasProductCanonicalizer,
        UnasProductSyncDiffEngine,
        UnasProductSyncRepository])
], UnasProductSyncService);
export { UnasProductSyncService };
//# sourceMappingURL=unas-product-sync.service.js.map