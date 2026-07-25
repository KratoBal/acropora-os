import type { PosProductSearchResult } from "@acropora/types";
import { PosProductSearchRepository } from "./pos-product-search.repository.js";
export declare class PosProductSearchService {
    private readonly repository;
    constructor(repository: PosProductSearchRepository);
    search(query: string | undefined): Promise<PosProductSearchResult[]>;
}
