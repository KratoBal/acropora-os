import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PosProductSearchRepository } from "./pos-product-search.repository.js";
import { PosProductSearchService } from "./pos-product-search.service.js";

describe("PosProductSearchService", () => {
  it("passes the query string through to the repository", async () => {
    let capturedQuery: string | undefined;
    const repository = {
      search: async (query: string) => {
        capturedQuery = query;
        return [];
      },
    } as unknown as PosProductSearchRepository;
    const service = new PosProductSearchService(repository);

    await service.search("reef");

    assert.equal(capturedQuery, "reef");
  });

  it("treats an undefined query as an empty string rather than crashing", async () => {
    let capturedQuery: string | undefined;
    const repository = {
      search: async (query: string) => {
        capturedQuery = query;
        return [];
      },
    } as unknown as PosProductSearchRepository;
    const service = new PosProductSearchService(repository);

    await service.search(undefined);

    assert.equal(capturedQuery, "");
  });
});
