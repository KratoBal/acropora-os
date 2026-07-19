import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NotFoundException } from "@nestjs/common";

import type { ProductRepository } from "./product.repository.js";
import { ProductService } from "./product.service.js";

function repositoryWith(product: { id: string } | null) {
  const calls: string[] = [];
  return {
    calls,
    repository: {
      create: async () => ({ id: "created" }),
      findById: async () => product,
      list: async () => ({ items: [], pagination: {} }),
      update: async () => {
        calls.push("update");
        return { id: "updated" };
      },
      archive: async () => {
        calls.push("archive");
        return { id: "archived" };
      },
    } as unknown as ProductRepository,
  };
}

describe("ProductService", () => {
  it("returns a product", async () => {
    const { repository } = repositoryWith({ id: "product-1" });
    const service = new ProductService(repository);
    assert.deepEqual(await service.getProduct("product-1"), {
      id: "product-1",
    });
  });

  it("throws for a missing product", async () => {
    const { repository } = repositoryWith(null);
    const service = new ProductService(repository);
    await assert.rejects(
      () => service.getProduct("missing"),
      NotFoundException,
    );
  });

  it("checks existence before update and archive", async () => {
    const { repository, calls } = repositoryWith({ id: "product-1" });
    const service = new ProductService(repository);
    await service.updateProduct("product-1", { name: "Updated" });
    await service.archiveProduct("product-1");
    assert.deepEqual(calls, ["update", "archive"]);
  });
});
