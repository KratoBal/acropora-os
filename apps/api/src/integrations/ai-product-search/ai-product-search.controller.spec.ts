import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";

import { AI_PRODUCT_SEARCH_MAX_HITS } from "./ai-product-search.config.js";
import { AiProductSearchController } from "./ai-product-search.controller.js";
import type { AiProductSearchService } from "./ai-product-search.service.js";

const controllerWith = () => {
  const calls: Array<{ query: string; limit?: number }> = [];
  const controller = new AiProductSearchController({
    search: async (input: { query: string; limit?: number }) => {
      calls.push(input);
      return {
        query: input.query,
        hits: [],
        totalMatched: 0,
        oldestSyncedAt: null,
        projectionVersion: "test",
      };
    },
  } as unknown as AiProductSearchService);

  return { controller, calls };
};

describe("AiProductSearchController", () => {
  it("refuses an empty query instead of answering with everything", async () => {
    /**
     * "Return the whole catalogue" is never what a caller meant, and it is
     * exactly the request that would push the conversation out of the model's
     * context window.
     */
    const { controller } = controllerWith();

    for (const query of [undefined, "", "   "]) {
      await assert.rejects(
        async () => controller.search(query),
        BadRequestException,
      );
    }
  });

  it("refuses an absurdly long query", async () => {
    const { controller } = controllerWith();

    await assert.rejects(
      async () => controller.search("x".repeat(201)),
      BadRequestException,
    );
  });

  it("trims the query before it reaches the search", async () => {
    const { controller, calls } = controllerWith();

    await controller.search("  fauna marin  ");

    assert.equal(calls[0]?.query, "fauna marin");
  });

  it("caps the limit, and a malformed one falls back rather than failing", async () => {
    /**
     * The ceiling is what protects the context window; the fallback is a
     * judgement call: refusing the whole search over a mistyped number would
     * trade a useful answer for a pedantic one. The ceiling still applies, so
     * a wrong value cannot widen anything.
     */
    const { controller, calls } = controllerWith();

    await controller.search("x", "999");
    await controller.search("x", "nem-szam");
    await controller.search("x", "-3");
    await controller.search("x", "3");

    assert.deepEqual(
      calls.map((call) => call.limit),
      [
        AI_PRODUCT_SEARCH_MAX_HITS,
        AI_PRODUCT_SEARCH_MAX_HITS,
        AI_PRODUCT_SEARCH_MAX_HITS,
        3,
      ],
    );
  });
});
