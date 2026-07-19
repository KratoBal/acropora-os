import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { UnauthorizedException } from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";
import { AuthService } from "../auth/auth.service.js";
import { AuthUserResolver } from "../auth/auth-user-resolver.js";
import { BrandsRepository } from "./brands.repository.js";
import { BrandImportAssistantService } from "./brand-import-assistant.service.js";

const enabled = process.env.RUN_BRAND_INTEGRATION === "1";
const repository = new BrandsRepository();
const assistant = new BrandImportAssistantService();
const actorId = "brand-test-owner";
const assistantFile = "brand-test-m1-assistant.xlsx";

async function cleanup() {
  const batches = await prisma.catalogImportBatch.findMany({
    where: { sourceFileName: assistantFile },
    select: { id: true },
  });
  await prisma.auditLog.deleteMany({
    where: { entityId: { in: batches.map((batch) => batch.id) } },
  });
  await prisma.catalogImportBatch.deleteMany({
    where: { sourceFileName: assistantFile },
  });
  await prisma.domainEvent.deleteMany({
    where: {
      aggregateType: "Brand",
      OR: [
        { actorUserId: actorId },
        { payload: { path: ["name"], equals: "M1 Test Auth Actor" } },
      ],
    },
  });
  await prisma.externalReference.deleteMany({
    where: { entityType: "BRAND", externalId: { startsWith: "BRAND-TEST" } },
  });
  await prisma.product.deleteMany({
    where: { name: { startsWith: "Brand test" } },
  });
  await prisma.brand.deleteMany({
    where: {
      OR: [
        { slug: { startsWith: "brand-test" } },
        { slug: { startsWith: "m1-test" } },
        {
          normalizedName: {
            in: ["quendorium", "vexalune", "qzxvoria", "zorblax"],
          },
        },
      ],
    },
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

  it("development login resolves a persisted User.id for DomainEvent audit", async () => {
    const session = await new AuthService(
      new AuthUserResolver(),
    ).loginWithDevelopmentUser("owner@acropora.local");
    const persisted = await prisma.user.findUnique({
      where: { id: session.user.id },
    });
    assert.equal(persisted?.email, "owner@acropora.local");
    assert.notEqual(session.user.id, "dev-owner");
    const created = await repository.create(
      { name: "M1 Test Auth Actor", aliases: [] },
      session.user.id,
    );
    const event = await prisma.domainEvent.findFirstOrThrow({
      where: { aggregateId: created.id, eventType: "brand.created" },
    });
    assert.equal(event.actorUserId, persisted?.id);
  });

  it("rejects an identity without an internal User with a controlled auth error", async () => {
    await assert.rejects(
      () =>
        new AuthUserResolver().resolveExistingIdentity({
          id: "missing-external-subject",
          email: "missing-user@acropora.invalid",
          displayName: "Missing User",
          role: "VIEWER",
        }),
      UnauthorizedException,
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

  it("bulk creates multiple missing Brands and records an audit summary", async () => {
    const batch = await prisma.catalogImportBatch.create({
      data: {
        provider: "UNAS",
        sourceFileName: assistantFile,
        fileSha256: "brand-test-m1-assistant-hash",
        analysisVersion: "brand-test-m1-v1",
        status: "VALIDATED",
        rows: {
          create: ["Quendorium", "Vexalune"].map((brandName, index) => ({
            entityType: "PRODUCT",
            sourceRowNumber: index + 2,
            sku: `M1-SKU-${index}`,
            rawPayload: { brandName },
            parsedPayload: {
              sourceRowNumber: index + 2,
              sku: `M1-SKU-${index}`,
              name: `M1 product ${index}`,
              brandName,
              rawPayload: { brandName },
            },
            issues: [],
            status: "VALID",
          })),
        },
      },
    });
    const listed = await assistant.rows(batch.id, {
      page: 1,
      pageSize: 25,
    });
    const input = {
      rowIds: listed.items.map((row) => row.id),
      expectedUpdatedAt: Object.fromEntries(
        listed.items.map((row) => [row.id, row.updatedAt]),
      ),
    };
    const result = await assistant.bulkCreate(batch.id, input, actorId);
    assert.equal(result.summary.CREATED, 2, JSON.stringify(result));
    assert.equal(result.summary.FAILED, 0);
    assert.equal(
      await prisma.auditLog.count({
        where: {
          entityId: batch.id,
          action: "brand.import-assistant.bulk-create",
        },
      }),
      1,
    );
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: {
        entityId: batch.id,
        action: "brand.import-assistant.bulk-create",
      },
    });
    assert.equal(audit.userId, actorId);
    assert.ok(await prisma.user.findUnique({ where: { id: audit.userId! } }));

    const repeated = await assistant.bulkCreate(batch.id, input, actorId);
    assert.equal(repeated.summary.ALREADY_RESOLVED, 2);
    assert.equal(
      await prisma.brand.count({
        where: { normalizedName: { in: ["quendorium", "vexalune"] } },
      }),
      2,
    );
  });

  it("collapses normalized source duplicates before bulk creation", async () => {
    const batch = await prisma.catalogImportBatch.findFirstOrThrow({
      where: { sourceFileName: assistantFile },
    });
    await prisma.catalogImportRow.create({
      data: {
        batchId: batch.id,
        entityType: "PRODUCT",
        sourceRowNumber: 10,
        sku: "M1-SKU-DUPLICATE",
        rawPayload: { brandName: "Quendorium" },
        parsedPayload: {
          sourceRowNumber: 10,
          sku: "M1-SKU-DUPLICATE",
          name: "M1 duplicate product",
          brandName: "Quendorium",
          rawPayload: { brandName: "Quendorium" },
        },
        issues: [],
        status: "VALID",
      },
    });
    const listed = await assistant.rows(batch.id, {
      page: 1,
      pageSize: 25,
      sourceValue: "Quendorium",
    });
    assert.equal(listed.items.length, 1);
    assert.equal(listed.items[0]?.occurrenceCount, 2);
  });

  it("creates one assistant Brand with the resolved development User.id", async () => {
    const batch = await prisma.catalogImportBatch.findFirstOrThrow({
      where: { sourceFileName: assistantFile },
    });
    await prisma.catalogImportRow.create({
      data: {
        batchId: batch.id,
        entityType: "PRODUCT",
        sourceRowNumber: 12,
        sku: "M1-AUTH-CREATE",
        rawPayload: { brandName: "Qzxvoria" },
        parsedPayload: {
          sourceRowNumber: 12,
          sku: "M1-AUTH-CREATE",
          name: "M1 auth regression product",
          brandName: "Qzxvoria",
          rawPayload: { brandName: "Qzxvoria" },
        },
        issues: [],
        status: "VALID",
      },
    });
    const session = await new AuthService(
      new AuthUserResolver(),
    ).loginWithDevelopmentUser("owner@acropora.local");
    const listed = await assistant.rows(batch.id, {
      page: 1,
      pageSize: 25,
      sourceValue: "Qzxvoria",
    });
    const source = listed.items[0]!;
    assert.equal(source.classification, "MISSING_BRAND");

    const result = await assistant.createBrand(
      batch.id,
      source.id,
      {
        canonicalName: "Qzxvoria",
        createAlias: false,
        createExternalMapping: false,
        expectedUpdatedAt: source.updatedAt,
      },
      session.user.id,
    );
    const created = result.createdBrands[0]!;
    const event = await prisma.domainEvent.findFirstOrThrow({
      where: { aggregateId: created.id, eventType: "brand.created" },
    });
    assert.equal(event.actorUserId, session.user.id);
    assert.notEqual(event.actorUserId, "dev-owner");
    assert.ok(
      await prisma.user.findUnique({ where: { id: event.actorUserId! } }),
    );
  });

  it("returns a partial conflict without rolling back successful rows", async () => {
    const batch = await prisma.catalogImportBatch.findFirstOrThrow({
      where: { sourceFileName: assistantFile },
    });
    await prisma.brand.create({
      data: {
        name: "Archivedium",
        normalizedName: "archivedium",
        slug: "m1-test-archivedium",
        isActive: false,
        archivedAt: new Date(),
      },
    });
    await prisma.catalogImportRow.createMany({
      data: ["Zorblax", "Archivedium"].map((brandName, index) => ({
        batchId: batch.id,
        entityType: "PRODUCT",
        sourceRowNumber: index + 20,
        sku: `M1-PARTIAL-${index}`,
        rawPayload: { brandName },
        parsedPayload: {
          sourceRowNumber: index + 20,
          sku: `M1-PARTIAL-${index}`,
          name: `M1 partial product ${index}`,
          brandName,
          rawPayload: { brandName },
        },
        issues: [],
        status: "VALID",
      })),
    });
    const listed = await assistant.rows(batch.id, {
      page: 1,
      pageSize: 25,
    });
    const selected = listed.items.filter((row) =>
      ["Zorblax", "Archivedium"].includes(row.sourceValue),
    );
    const result = await assistant.bulkCreate(
      batch.id,
      {
        rowIds: selected.map((row) => row.id),
        expectedUpdatedAt: Object.fromEntries(
          selected.map((row) => [row.id, row.updatedAt]),
        ),
      },
      actorId,
    );
    assert.equal(result.summary.CREATED, 1);
    assert.equal(result.summary.CONFLICT, 1);
    assert.equal(
      await prisma.brand.count({ where: { normalizedName: "zorblax" } }),
      1,
    );
  });
});
