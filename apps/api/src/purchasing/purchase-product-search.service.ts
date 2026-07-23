import { Injectable } from "@nestjs/common";
import type { PurchaseProductSearchResult } from "@acropora/types";

import { PurchaseProductSearchRepository } from "./purchase-product-search.repository.js";

@Injectable()
export class PurchaseProductSearchService {
  constructor(private readonly repository: PurchaseProductSearchRepository) {}

  search(query: string | undefined): Promise<PurchaseProductSearchResult[]> {
    return this.repository.search(query ?? "");
  }
}
