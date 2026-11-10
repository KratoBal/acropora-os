import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";
import { plainToInstance } from "class-transformer";

import { nincsMaradek } from "../common/takaritas-leltar.js";
import { integrationDatabaseGate } from "../common/integration-database.js";
import { UpdateProductHusbandryDto } from "./dto/update-product-husbandry.dto.js";
import { ProductHusbandryRepository } from "./product-husbandry.repository.js";
import { husbandryDecision } from "./product-husbandry.service.js";

const gate = integrationDatabaseGate(process.env);
const runIntegration = gate.mode !== "skip";

/**
 * THE HUSBANDRY BLOCK'S STORE, MEASURED ON THE DATABASE (V2.2, card d2fc06e7).
 *
 * What this proves: the upsert creates the datasheet row for a product that has none and updates only the given columns on
 * an existing one; the verification is stamped by the server and withdrawn by an edit; the livestock kind comes from the
 * category tree; the write is logged (audit row and domain event) with the before and after.
 *
 * What it does NOT prove: that any staging or production row is in order. The CI database is freshly migrated and empty.
 */
const PREFIX = `husbandry-${Date.now()}`;
const dto = (body: Record<string, unknown>) =>
  plainToInstance(UpdateProductHusbandryDto, body);

describe("husbandry store, on the database", { skip: !runIntegration }, () => {
  const repository = new ProductHusbandryRepository();
  let userId = "";
  let productId = "";
  let categoryId = "";

  before(async () => {
    if (gate.mode === "refuse") throw new Error(gate.reason);
    userId = (
      await prisma.user.create({
        data: {
          email: `${PREFIX}@example.invalid`,
          displayName: PREFIX,
          role: "OWNER",
        },
        select: { id: true },
      })
    ).id;
    categoryId = (
      await prisma.category.create({
        data: { name: "Halak", slug: `${PREFIX}-halak` },
        select: { id: true },
      })
    ).id;
    productId = (
      await prisma.product.create({
        data: { name: `${PREFIX} product`, isActive: true },
        select: { id: true },
      })
    ).id;
    await prisma.productCategory.create({
      data: { productId, categoryId, isPrimary: true, source: "MANUAL" },
    });
  });

  after(async () => {
    await prisma.auditLog.deleteMany({ where: { entityId: productId } });
    await prisma.domainEvent.deleteMany({ where: { aggregateId: productId } });
    await prisma.product.deleteMany({
      where: { name: { startsWith: PREFIX } },
    });
    await prisma.category.deleteMany({ where: { id: categoryId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    nincsMaradek([
      {
        nev: "the suite's products survived the cleanup",
        darab: await prisma.product.count({
          where: { name: { startsWith: PREFIX } },
        }),
      },
      {
        nev: "the suite's audit rows survived the cleanup",
        darab: await prisma.auditLog.count({ where: { entityId: productId } }),
      },
    ]);
    await prisma.$disconnect();
  });

  const write = (body: Record<string, unknown>, now = new Date()) =>
    repository.write(productId, userId, (current) =>
      husbandryDecision(current, dto(body), userId, now),
    );

  it("a product with no datasheet row: the first write creates it, and the kind comes from the category tree", async () => {
    assert.equal(
      await prisma.productDatasheet.count({ where: { productId } }),
      0,
    );
    const result = await write({
      genus: "Zebrasoma",
      kinekNem: "Kis medencébe nem ajánljuk.",
    });
    assert.equal(result.kind, "ok");
    assert.ok(result.kind === "ok");
    assert.equal(result.husbandry.livestockKind, "FISH");
    assert.equal(result.husbandry.facts.genus, "Zebrasoma");
    assert.equal(
      result.husbandry.facts.kinekNem,
      "Kis medencébe nem ajánljuk.",
    );
    assert.equal(result.husbandry.verification.verified, false);
    assert.ok(result.husbandry.missing.includes("careDifficulty"));
    assert.equal(
      await prisma.productDatasheet.count({ where: { productId } }),
      1,
    );
  });

  it("an update changes only the given columns", async () => {
    const result = await write({ medenceErettsegHonap: 6, minLiter: 300 });
    assert.ok(result.kind === "ok");
    assert.equal(result.husbandry.facts.medenceErettsegHonap, 6);
    assert.equal(result.husbandry.facts.minLiter, "300");
    assert.equal(result.husbandry.facts.genus, "Zebrasoma");
    assert.equal(
      result.husbandry.facts.kinekNem,
      "Kis medencébe nem ajánljuk.",
    );
  });

  it("the verification is stamped with the actor and the given clock, and an edit without verifying withdraws it", async () => {
    const at = new Date("2026-11-10T10:00:00.000Z");
    const verified = await write(
      {
        forrasTipus: "szakirodalom",
        forrasHivatkozas: "https://example.invalid/x",
        ellenorizve: true,
      },
      at,
    );
    assert.ok(verified.kind === "ok");
    assert.equal(verified.husbandry.verification.verified, true);
    assert.equal(verified.husbandry.verification.byUserId, userId);
    assert.equal(verified.husbandry.verification.at, at.toISOString());

    const edited = await write({ etetesGyakorisag: "naponta" });
    assert.ok(edited.kind === "ok");
    assert.equal(edited.husbandry.verification.verified, false);
    assert.equal(edited.husbandry.verification.byUserId, null);
    assert.equal(edited.husbandry.verification.at, null);
  });

  it("a list cleared with null is empty, and the first step is refused for an Acropora genus without writing anything", async () => {
    await write({ aggression: ["BEKES"] });
    const cleared = await write({ aggression: null });
    assert.ok(cleared.kind === "ok");
    assert.deepEqual(cleared.husbandry.facts.aggression, []);

    await write({ genus: "Acropora" });
    const before = await prisma.productDatasheet.findUnique({
      where: { productId },
    });
    const refused = await write({ careDifficulty: "KONNYU" });
    assert.equal(refused.kind, "refused");
    const after = await prisma.productDatasheet.findUnique({
      where: { productId },
    });
    assert.equal(after?.careDifficulty, before?.careDifficulty);
  });

  it("every write is logged with the before and after of the changed facts", async () => {
    const rows = await prisma.auditLog.findMany({
      where: { entityId: productId, action: "product_husbandry.updated" },
      orderBy: { createdAt: "asc" },
    });
    assert.ok(rows.length >= 4);
    assert.equal(rows[0]!.userId, userId);
    const first = rows[0]!.metadata as {
      before: Record<string, unknown>;
      after: Record<string, unknown>;
    };
    assert.equal(first.before.genus, null);
    assert.equal(first.after.genus, "Zebrasoma");
    const events = await prisma.domainEvent.count({
      where: { aggregateId: productId, eventType: "product.husbandry.updated" },
    });
    assert.equal(events, rows.length);
  });

  it("an unknown product is not-found", async () => {
    const result = await repository.write("nincs-ilyen", userId, (current) =>
      husbandryDecision(current, dto({ kinekNem: "x" }), userId, new Date()),
    );
    assert.equal(result.kind, "not-found");
  });
});
