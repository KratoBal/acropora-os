import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ConflictException, NotFoundException } from "@nestjs/common";

import type { ProductRepository } from "./product.repository.js";
import { ProductService } from "./product.service.js";

function repositoryWith(
  product: {
    id: string;
    catalogAuthority: "UNAS" | "ACROPORA" | null;
    unasMirror?: { source: "UNAS" } | null;
  } | null,
) {
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
      takeCatalogAuthority: async () => {
        calls.push("takeCatalogAuthority");
        return {
          product: { id: product?.id, catalogAuthority: "ACROPORA" },
          changed: true,
        };
      },
    } as unknown as ProductRepository,
  };
}

describe("ProductService", () => {
  it("returns a product", async () => {
    const { repository } = repositoryWith({
      id: "product-1",
      catalogAuthority: "ACROPORA",
    });
    const service = new ProductService(repository);
    assert.deepEqual(await service.getProduct("product-1"), {
      id: "product-1",
      catalogAuthority: "ACROPORA",
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
    const { repository, calls } = repositoryWith({
      id: "product-1",
      catalogAuthority: "ACROPORA",
      unasMirror: null,
    });
    const service = new ProductService(repository);
    await service.updateProduct("product-1", { name: "Updated" });
    await service.archiveProduct("product-1");
    assert.deepEqual(calls, ["update", "archive"]);
  });

  it("blocks generic writes to an UNAS managed product", async () => {
    const { repository, calls } = repositoryWith({
      id: "product-1",
      catalogAuthority: "UNAS",
      unasMirror: { source: "UNAS" },
    });
    const service = new ProductService(repository);

    await assert.rejects(
      service.updateProduct("product-1", { name: "Forbidden" }),
      (error) =>
        error instanceof ConflictException &&
        error.message === "PRODUCT_MANAGED_BY_UNAS",
    );
    await assert.rejects(
      service.archiveProduct("product-1"),
      ConflictException,
    );
    assert.deepEqual(calls, []);
  });

  /**
   * The transfer is allowed exactly where the generic write is NOT: an
   * UNAS-managed product is the only thing worth taking over. Asserting only
   * that it succeeds on an ACROPORA product would pass on a service that
   * refuses the case the feature exists for.
   */
  it("takes authority from a product the webshop manages", async () => {
    const { repository, calls } = repositoryWith({
      id: "product-1",
      catalogAuthority: "UNAS",
      unasMirror: { source: "UNAS" },
    });
    const service = new ProductService(repository);

    const result = await service.takeCatalogAuthority("product-1", "user-1");

    assert.deepEqual(calls, ["takeCatalogAuthority"]);
    assert.equal(
      (result as { catalogAuthority: string }).catalogAuthority,
      "ACROPORA",
    );
  });

  /**
   * Unresolved authority means we do not know who owns the row. Handing it
   * over on a guess is the one outcome that cannot be undone by a later
   * sync, so it fails closed here exactly as the generic write does.
   */
  it("refuses to hand over a product whose owner is unknown", async () => {
    const { repository, calls } = repositoryWith({
      id: "product-1",
      catalogAuthority: null,
    });
    const service = new ProductService(repository);

    await assert.rejects(
      service.takeCatalogAuthority("product-1", "user-1"),
      (error) =>
        error instanceof ConflictException &&
        error.message === "PRODUCT_CATALOG_AUTHORITY_UNRESOLVED",
    );
    assert.deepEqual(calls, []);
  });

  it("throws for a missing product before touching the repository", async () => {
    const { repository, calls } = repositoryWith(null);
    const service = new ProductService(repository);

    await assert.rejects(
      () => service.takeCatalogAuthority("missing", "user-1"),
      NotFoundException,
    );
    assert.deepEqual(calls, []);
  });

  it("fails closed when catalog authority has not been resolved", async () => {
    const { repository, calls } = repositoryWith({
      id: "product-1",
      catalogAuthority: null,
    });
    const service = new ProductService(repository);

    await assert.rejects(
      service.updateProduct("product-1", { name: "Forbidden" }),
      (error) =>
        error instanceof ConflictException &&
        error.message === "PRODUCT_CATALOG_AUTHORITY_UNRESOLVED",
    );
    assert.deepEqual(calls, []);
  });
});
