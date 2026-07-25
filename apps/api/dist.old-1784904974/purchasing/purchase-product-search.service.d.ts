import type { PurchaseProductSearchResult } from "@acropora/types";
import { PurchaseProductSearchRepository } from "./purchase-product-search.repository.js";
export declare class PurchaseProductSearchService {
    private readonly repository;
    constructor(repository: PurchaseProductSearchRepository);
    search(query: string | undefined): Promise<PurchaseProductSearchResult[]>;
}
