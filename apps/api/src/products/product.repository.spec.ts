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
  categories: [
    {
      id: "product-category-1",
      productId: "product-1",
      categoryId: "category-1",
      isPrimary: true,
      sortOrder: 0,
      source: "UNAS",
      createdAt: new Date("2026-07-19T10:00:00.000Z"),
      category: {
        id: "category-1",
        name: "Tengeri akvarisztika",
        slug: "tengeri-akvarisztika",
        parentId: null,
        createdAt: new Date("2026-07-19T10:00:00.000Z"),
        updatedAt: new Date("2026-07-19T10:00:00.000Z"),
      },
    },
  ],
  channelListings: [
    {
      id: "listing-1",
      productId: "product-1",
      channel: "UNAS",
      externalStatus: "3",
      isPublished: false,
      slug: null,
      productUrl: null,
      seoTitle: null,
      seoDescription: null,
      seoKeywords: null,
      seoRobots: null,
      backorderAllowed: false,
      sourceCreatedAt: null,
      sourceUpdatedAt: null,
      metadata: null,
      createdAt: new Date("2026-07-19T10:00:00.000Z"),
      updatedAt: new Date("2026-07-19T10:00:00.000Z"),
    },
  ],
  images: [
    {
      id: "image-1",
      productId: "product-1",
      url: "https://example.invalid/first.jpg",
      sortOrder: 1,
      altText: null,
      title: null,
      fileName: "first.jpg",
      source: "UNAS",
      createdAt: new Date("2026-07-19T10:00:00.000Z"),
    },
    {
      id: "image-2",
      productId: "product-1",
      url: "https://example.invalid/second.jpg",
      sortOrder: 2,
      altText: null,
      title: null,
      fileName: "second.jpg",
      source: "UNAS",
      createdAt: new Date("2026-07-19T10:00:00.000Z"),
    },
  ],
  variants: [
    {
      id: "variant-1",
      productId: "product-1",
      sku: "REEF-SALT-01",
      name: null,
      unit: "db",
      vatRate: null,
      isActive: true,
      createdAt: new Date("2026-07-19T10:00:00.000Z"),
      updatedAt: new Date("2026-07-19T10:00:00.000Z"),
    },
  ],
} as ProductWithRelations;

function createDatabase() {
  const calls: Array<{ operation: string; args: unknown }> = [];
  const transaction = {
    product: {
      create: async (args: unknown) => {
        calls.push({ operation: "create", args });
        return product;
      },
      findUnique: async (args: unknown) => {
        calls.push({ operation: "transactionFind", args });
        return product;
      },
      update: async (args: unknown) => {
        calls.push({ operation: "transactionUpdate", args });
        return product;
      },
    },
    productCategory: {
      updateMany: async (args: unknown) => {
        calls.push({ operation: "categoryUpdateMany", args });
        return { count: 1 };
      },
      upsert: async (args: unknown) => {
        calls.push({ operation: "categoryUpsert", args });
        return {};
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
    category: {
      findMany: async () => [
        { id: "child", name: "LED lámpák", parentId: "root" },
        { id: "root", name: "Világítás", parentId: null },
      ],
    },
    brand: {
      findMany: async () => [
        { id: "brand-1", name: "Aqua Medic" },
        { id: "brand-2", name: "Red Sea" },
      ],
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
      {
        name: "Reef Salt",
        productType: "PHYSICAL",
        primaryCategoryId: "category-1",
      },
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
    const createArgs = calls[0]?.args as {
      data: {
        categoryId: string;
        categories: { create: { isPrimary: boolean } };
      };
    };
    assert.equal(createArgs.data.categoryId, "category-1");
    assert.equal(createArgs.data.categories.create.isPrimary, true);
  });

  it("replaces the application-level primary category", async () => {
    const { database, calls } = createDatabase();
    const repository = new ProductRepository(database);
    await repository.update("product-1", { primaryCategoryId: "category-2" });

    assert.deepEqual(
      calls.map((call) => call.operation),
      [
        "transactionUpdate",
        "categoryUpdateMany",
        "categoryUpsert",
        "transactionFind",
      ],
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
    assert.deepEqual(findArgs.where.categories, {
      some: { categoryId: "category-1" },
    });
    assert.equal(result.pagination.totalPages, 3);
    assert.equal(result.items[0]?.primarySku, "REEF-SALT-01");
    assert.equal(
      result.items[0]?.primaryCategory?.name,
      "Tengeri akvarisztika",
    );
    assert.equal(result.items[0]?.thumbnail?.sortOrder, 1);
    assert.equal(result.items[0]?.unasListing?.externalStatus, "3");
  });

  it("returns category, raw channel status and images in detail order", async () => {
    const { database } = createDatabase();
    const repository = new ProductRepository(database);
    const detail = await repository.findById("product-1");

    assert.equal(detail?.categories[0]?.isPrimary, true);
    assert.equal(detail?.channelListings[0]?.externalStatus, "3");
    assert.deepEqual(
      detail?.images.map((image) => image.sortOrder),
      [1, 2],
    );
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

  it("returns hierarchical category and ordered brand options", async () => {
    const { database } = createDatabase();
    const repository = new ProductRepository(database);

    assert.deepEqual(await repository.listCategoryOptions(), [
      { id: "root", label: "Világítás" },
      { id: "child", label: "Világítás / LED lámpák" },
    ]);
    assert.deepEqual(await repository.listBrandOptions(), [
      { id: "brand-1", label: "Aqua Medic" },
      { id: "brand-2", label: "Red Sea" },
    ]);
  });
});
