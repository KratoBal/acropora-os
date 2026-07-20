import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NotFoundException } from "@nestjs/common";

import type { ProductExtensionRepository } from "./product-extension.repository.js";
import { ProductExtensionService } from "./product-extension.service.js";

function createService(variantExists: boolean) {
  const calls: Array<{ operation: string; input?: unknown }> = [];
  const repository = {
    variantExists: async () => variantExists,
    findByVariantId: async () => null,
    upsert: async (_variantId: string, input: unknown, actorUserId: string) => {
      calls.push({ operation: "upsert", input: { input, actorUserId } });
      return { variantId: "variant-1" };
    },
  } as unknown as ProductExtensionRepository;
  return { service: new ProductExtensionService(repository), calls };
}

describe("ProductExtensionService", () => {
  it("rejects an unknown variant", async () => {
    const { service } = createService(false);
    await assert.rejects(service.getByVariantId("missing"), NotFoundException);
  });

  it("upserts only through the extension repository", async () => {
    const { service, calls } = createService(true);
    const input = { reorderPoint: "5.5", autoReorderEnabled: true };
    await service.upsert("variant-1", input, "user-1");
    assert.deepEqual(calls, [
      { operation: "upsert", input: { input, actorUserId: "user-1" } },
    ]);
  });
});
