import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Prisma, prisma } from "@acropora/database";
import { BrandsRepository } from "./brands.repository.js";

const enabled = process.env.RUN_BRAND_INTEGRATION === "1";
const repository = new BrandsRepository();
const actorId = "brand-test-owner";

async function cleanup() {
  await prisma.domainEvent.deleteMany({
    where: { aggregateType: "Brand", actorUserId: actorId },
  });
  await prisma.externalReference.deleteMany({
    where: { entityType: "BRAND", externalId: { startsWith: "BRAND-TEST" } },
  });
  await prisma.product.deleteMany({
    where: { name: { startsWith: "Brand test" } },
  });
  await prisma.brand.deleteMany({
    where: { slug: { startsWith: "brand-test" } },
  });
  await prisma.user.deleteMany({ where: { id: actorId } });
}

describe("Brand database integration", { skip: !enabled }, () => {
  before(async () => {
    await cleanup();
    await prisma.user.create({
      data: {
        id: actorId,
        email: "brand-test@acropora.local",
        displayName: "Brand Test",
        role: "OWNER",
      },
    });
  });
  after(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("persists Brand, aliases, mapping and DomainEvent atomically", async () => {
    const brand = await repository.create(
      {
        name: "Brand Test Alpha",
        aliases: [{ alias: "BTA", source: "UNAS", isPreferred: true }],
        unasExternalId: "BRAND-TEST-1",
      },
      actorId,
    );
    assert.equal(brand.aliases[0]?.normalizedAlias, "bta");
    assert.equal(brand.externalMappings[0]?.externalId, "BRAND-TEST-1");
    assert.equal(
      await prisma.domainEvent.count({
        where: { aggregateId: brand.id, eventType: "brand.created" },
      }),
      1,
    );
  });

  it("enforces normalized canonical and alias uniqueness", async () => {
    await assert.rejects(
      () =>
        repository.create({ name: "brand-test-alpha", aliases: [] }, actorId),
      (error: unknown) =>
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002",
    );
    const alpha = await prisma.brand.findUniqueOrThrow({
      where: { normalizedName: "brand test alpha" },
    });
    await assert.rejects(
      () =>
        repository.addAlias(
          alpha.id,
          { alias: "BTA", source: "UNAS", isPreferred: false },
          actorId,
        ),
      (error: unknown) =>
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002",
    );
  });

  it("archive preserves Product association and restore succeeds", async () => {
    const alpha = await prisma.brand.findUniqueOrThrow({
      where: { normalizedName: "brand test alpha" },
    });
    await prisma.product.create({
      data: { name: "Brand test product", brandId: alpha.id },
    });
    const archived = await repository.setArchived(alpha.id, true, actorId);
    assert.equal(archived.isActive, false);
    assert.equal(archived.usage.productCount, 1);
    const restored = await repository.setArchived(alpha.id, false, actorId);
    assert.equal(restored.isActive, true);
    assert.equal(restored.usage.productCount, 1);
  });

  it("rolls back Brand and event when an alias conflicts", async () => {
    await assert.rejects(() =>
      repository.create(
        {
          name: "Brand Test Rollback",
          aliases: [{ alias: "BTA", source: "UNAS", isPreferred: false }],
        },
        actorId,
      ),
    );
    assert.equal(
      await prisma.brand.count({
        where: { normalizedName: "brand test rollback" },
      }),
      0,
    );
    assert.equal(
      await prisma.domainEvent.count({
        where: {
          aggregateType: "Brand",
          payload: { path: ["name"], equals: "Brand Test Rollback" },
        },
      }),
      0,
    );
  });

  it("external mapping upsert is idempotent", async () => {
    const alpha = await prisma.brand.findUniqueOrThrow({
      where: { normalizedName: "brand test alpha" },
    });
    for (let index = 0; index < 2; index++)
      await prisma.externalReference.upsert({
        where: {
          system_entityType_externalId: {
            system: "UNAS",
            entityType: "BRAND",
            externalId: "BRAND-TEST-1",
          },
        },
        create: {
          system: "UNAS",
          entityType: "BRAND",
          entityId: alpha.id,
          externalId: "BRAND-TEST-1",
        },
        update: { entityId: alpha.id },
      });
    assert.equal(
      await prisma.externalReference.count({
        where: { externalId: "BRAND-TEST-1" },
      }),
      1,
    );
  });
});
