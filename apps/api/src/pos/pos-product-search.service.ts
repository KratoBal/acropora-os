import { Injectable } from "@nestjs/common";
import type { PosProductSearchResult } from "@acropora/types";

import { PosProductSearchRepository } from "./pos-product-search.repository.js";

@Injectable()
export class PosProductSearchService {
  constructor(private readonly repository: PosProductSearchRepository) {}

  search(query: string | undefined): Promise<PosProductSearchResult[]> {
    return this.repository.search(query ?? "");
  }
}
