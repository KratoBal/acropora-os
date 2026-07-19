import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ProductDatabase } from "./product.repository.js";
import { ProductRepository } from "./product.repository.js";
import type { ProductWithRelations } from "./product.types.js";

const product = {
  id: "product-1",
  name: "Reef Salt",
  description: null,
  type: "PHYSICAL",
  brandId: null,
  categoryId: null,
  isActive: true,
  archivedAt: null,
  createdAt: new Date("2026-07-19T10:00:00.000Z"),
  updatedAt: new Date("2026-07-19T10:00:00.000Z"),
  brand: null,
  category: null,
  variants: [],
} as ProductWithRelations;

function createDatabase() {
  const calls: Array<{ operation: string; args: unknown }> = [];
  const transaction = {
    product: {
      create: async (args: unknown) => {
        calls.push({ operation: "create", args });
        return product;
      },
    },
    domainEvent: {
      create: async (args: unknown) => {
        calls.push({ operation: "event", args });
        return {};
      },
    },
  };
  const database: ProductDatabase = {
    product: {
      findUnique: async () => product,
      findMany: async (args) => {
        calls.push({ operation: "findMany", args });
        return [product];
      },
      count: async (args) => {
        calls.push({ operation: "count", args });
        return 21;
      },
      update: async (args) => {
        calls.push({ operation: "update", args });
        return product;
      },
    },
    $transaction: (operation) => operation(transaction),
  };
  return { database, calls };
}

describe("ProductRepository", () => {
  it("creates the product and ProductCreated event in one transaction", async () => {
    const { database, calls } = createDatabase();
    const repository = new ProductRepository(database);

    await repository.create(
      { name: "Reef Salt", productType: "PHYSICAL" },
      "user-1",
    );

    assert.deepEqual(
      calls.map((call) => call.operation),
      ["create", "event"],
    );
    assert.equal(
      (
        calls[1]?.args as {
          data: { eventType: string; actorUserId: string };
        }
      ).data.eventType,
      "product.created",
    );
  });

  it("applies pagination and catalog filters", async () => {
    const { database, calls } = createDatabase();
    const repository = new ProductRepository(database);

    const result = await repository.list({
      page: 2,
      pageSize: 10,
      search: "salt",
      active: true,
      brandId: "brand-1",
      categoryId: "category-1",
    });

    const findArgs = calls.find((call) => call.operation === "findMany")
      ?.args as { skip: number; take: number; where: Record<string, unknown> };
    assert.equal(findArgs.skip, 10);
    assert.equal(findArgs.take, 10);
    assert.equal(findArgs.where.isActive, true);
    assert.equal(result.pagination.totalPages, 3);
  });

  it("soft archives instead of deleting", async () => {
    const { database, calls } = createDatabase();
    const repository = new ProductRepository(database);
    await repository.archive("product-1");

    const updateArgs = calls.find((call) => call.operation === "update")
      ?.args as { data: { isActive: boolean; archivedAt: Date } };
    assert.equal(updateArgs.data.isActive, false);
    assert.ok(updateArgs.data.archivedAt instanceof Date);
  });
});
