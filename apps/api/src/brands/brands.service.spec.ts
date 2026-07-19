import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@acropora/database";
import type { BrandsRepository } from "./brands.repository.js";
import { BrandsService } from "./brands.service.js";

const brand = {
  id: "brand-1",
  name: "OASE",
  normalizedName: "oase",
  slug: "oase",
  isActive: true,
  aliases: [],
  externalMappings: [],
  usage: { productCount: 2, reviewReferenceCount: 1 },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
};
const repository = (overrides: Record<string, unknown> = {}) =>
  ({
    list: async () => ({
      items: [brand],
      pagination: { page: 1, pageSize: 25, totalItems: 1, totalPages: 1 },
    }),
    detail: async () => brand,
    create: async () => brand,
    update: async () => brand,
    setArchived: async (_id: string, archived: boolean) => ({
      ...brand,
      isActive: !archived,
    }),
    addAlias: async () => ({
      ...brand,
      aliases: [{ id: "alias-1", alias: "Oase GmbH" }],
    }),
    updateAlias: async () => brand,
    removeAlias: async () => brand,
    ...overrides,
  }) as unknown as BrandsRepository;

describe("BrandsService", () => {
  it("creates a valid Brand", async () =>
    assert.equal(
      (
        await new BrandsService(repository()).create(
          { name: "OASE", aliases: [] },
          "owner",
        )
      ).id,
      "brand-1",
    ));
  it("maps normalized duplicate conflicts", async () => {
    const error = new Prisma.PrismaClientKnownRequestError("duplicate", {
      code: "P2002",
      clientVersion: "6",
    });
    await assert.rejects(
      () =>
        new BrandsService(
          repository({
            create: async () => {
              throw error;
            },
          }),
        ).create({ name: "oase", aliases: [] }, "owner"),
      ConflictException,
    );
  });
  it("updates with optimistic concurrency", async () =>
    assert.equal(
      (
        await new BrandsService(repository()).update(
          "brand-1",
          { name: "Oase", expectedUpdatedAt: brand.updatedAt },
          "owner",
        )
      ).name,
      "OASE",
    ));
  it("maps stale updates to conflict", async () =>
    await assert.rejects(
      () =>
        new BrandsService(
          repository({
            update: async () => {
              throw new Error("STALE_UPDATE");
            },
          }),
        ).update("brand-1", { expectedUpdatedAt: brand.updatedAt }, "owner"),
      ConflictException,
    ));
  it("archives while preserving usage information", async () => {
    const result = await new BrandsService(repository()).archive(
      "brand-1",
      "owner",
    );
    assert.equal(result.isActive, false);
    assert.equal(result.usage.productCount, 2);
  });
  it("restores archived Brand records", async () => {
    const service = new BrandsService(
      repository({ detail: async () => ({ ...brand, isActive: false }) }),
    );
    assert.equal((await service.restore("brand-1", "owner")).isActive, true);
  });
  it("adds, updates and removes aliases", async () => {
    const service = new BrandsService(repository());
    assert.equal(
      (
        await service.addAlias(
          "brand-1",
          { alias: "Oase GmbH", source: "UNAS", isPreferred: false },
          "owner",
        )
      ).aliases.length,
      1,
    );
    await service.updateAlias(
      "brand-1",
      "alias-1",
      { alias: "Oase", source: "UNAS", isPreferred: true },
      "owner",
    );
    await service.removeAlias("brand-1", "alias-1", "owner");
  });
  it("rejects missing Brands", async () =>
    await assert.rejects(
      () =>
        new BrandsService(repository({ detail: async () => null })).detail(
          "missing",
        ),
      NotFoundException,
    ));
  it("returns deterministic repository pagination", async () => {
    const result = await new BrandsService(repository()).list({
      page: 1,
      pageSize: 25,
      status: "ACTIVE",
    });
    assert.deepEqual(
      result.items.map((item) => item.name),
      ["OASE"],
    );
  });
});
