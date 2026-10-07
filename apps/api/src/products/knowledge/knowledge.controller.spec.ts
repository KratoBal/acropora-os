import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AuthenticatedUser } from "@acropora/types";

import { ProductKnowledgeController } from "./knowledge.controller.js";
import type { ProductKnowledgeService } from "./knowledge.service.js";

/**
 * THE COPY SAVE CARRIES `usedFields` THROUGH (SEO P0 PR 1b; barracuda's
 * preview, point D). Without it the panel's ticks would be shown, and every
 * save would write an empty list, the product-wide rule, without a sound.
 *
 * WHAT TURNS IT RED: the controller passes only `body.body` again.
 */
describe("the knowledge controller", () => {
  it("passes the body's usedFields to the service", async () => {
    const hivasok: unknown[][] = [];
    const service = {
      saveCopy: async (...args: unknown[]) => {
        hivasok.push(args);
        return {};
      },
    } as unknown as ProductKnowledgeService;
    const user = { id: "u-owner" } as AuthenticatedUser;
    await new ProductKnowledgeController(service).saveCopy(
      "p-1",
      "lead",
      { body: "Korallokhoz.", usedFields: ["application"] },
      user,
    );
    assert.deepEqual(hivasok, [
      ["p-1", "lead", "Korallokhoz.", user, ["application"]],
    ]);
  });
});
