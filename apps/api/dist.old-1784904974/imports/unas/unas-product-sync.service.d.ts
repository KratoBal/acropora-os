import type { UnasProductSyncSummary } from "@acropora/types";
import { UnasApiClient } from "./unas-api.client.js";
import { UnasProductCanonicalizer } from "./unas-product-canonicalizer.js";
import { UnasProductSyncDiffEngine } from "./unas-product-sync-diff.engine.js";
import { UnasProductSyncRepository } from "./unas-product-sync.repository.js";
export declare class UnasProductSyncService {
    private readonly api;
    private readonly canonicalizer;
    private readonly diffEngine;
    private readonly repository;
    constructor(api: UnasApiClient, canonicalizer: UnasProductCanonicalizer, diffEngine: UnasProductSyncDiffEngine, repository: UnasProductSyncRepository);
    runIncremental(token: string, windowEnd?: Date, pageSize?: number): Promise<UnasProductSyncSummary>;
    private downloadProducts;
    private downloadCategories;
    private assertUniqueSourceIdentity;
}
