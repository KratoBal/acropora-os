import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Prisma, prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { nincsMaradek } from "../../common/takaritas-leltar.js";
import { PrismaEnrichmentReader } from "../enrichment/enrichment-read.repository.js";
import { PrismaEnrichmentFactsReader } from "../enrichment/enrichment-run.store.js";
import type { ProductService } from "../product.service.js";
import { PrismaKnowledgeStore } from "./knowledge.repository.js";
import { ProductKnowledgeService } from "./knowledge.service.js";

/**
 * PRODUCT KNOWLEDGE ON A REAL DATABASE (#1431).
 *
 * 1. The conflict path through the Prisma store: two manual entries become
 *    two ordinary finished runs, the second result is CONFLICTING_SOURCES,
 *    and the accepted fact has no value but points at that result.
 * 2. RESTRICT: the run behind an accepted fact cannot be deleted; once the
 *    fact is gone, it can.
 * 3. The review reads the newest result PER FIELD: a one-field manual check
 *    does not hide the fields of an earlier crawl check.
 *
 * Invented product, user and URLs only.
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = "KNOWLEDGE-INT-";
const EMAIL_DOMAIN = "product-knowledge-integration.invalid";

describe("Termékismeret, adatbázison", { skip: gate.mode === "skip" }, () => {
  const suffix = Date.now() % 1_000_000;
  let productId = "";
  let userId = "";

  before(async () => {
    if (gate.mode === "refuse") throw new Error(gate.reason);
    await removeLeftovers();
    const user = await prisma.user.create({
      data: {
        email: `owner-${suffix}@${EMAIL_DOMAIN}`,
        displayName: "Kitalált Elfogadó",
        role: "OWNER",
        isActive: true,
      },
    });
    userId = user.id;
    const product = await prisma.product.create({
      data: { name: `${PREFIX}Amino ${suffix}` },
    });
    productId = product.id;
  });

  after(removeLeftovers);

  async function removeLeftovers() {
    const mine = { product: { name: { startsWith: PREFIX } } };
    // Facts first: they hold the Restrict key on the field results.
    await prisma.productKnowledgeFact.deleteMany({ where: mine });
    await prisma.productCopy.deleteMany({ where: mine });
    await prisma.productEnrichmentRun.deleteMany({
      where: { requestedBy: { email: { endsWith: EMAIL_DOMAIN } } },
    });
    await prisma.product.deleteMany({
      where: { name: { startsWith: PREFIX } },
    });
    await prisma.user.deleteMany({
      where: { email: { endsWith: EMAIL_DOMAIN } },
    });
    nincsMaradek([
      {
        nev: "ProductKnowledgeFact",
        darab: await prisma.productKnowledgeFact.count({ where: mine }),
      },
      {
        nev: "ProductCopy",
        darab: await prisma.productCopy.count({ where: mine }),
      },
      {
        nev: "ProductEnrichmentRun",
        darab: await prisma.productEnrichmentRun.count({
          where: { requestedBy: { email: { endsWith: EMAIL_DOMAIN } } },
        }),
      },
      {
        nev: "Product",
        darab: await prisma.product.count({
          where: { name: { startsWith: PREFIX } },
        }),
      },
      {
        nev: "User",
        darab: await prisma.user.count({
          where: { email: { endsWith: EMAIL_DOMAIN } },
        }),
      },
    ]);
  }

  function knowledge() {
    const products = {
      getProduct: async (id: string) => ({ id }),
    } as unknown as ProductService;
    return new ProductKnowledgeService(
      products,
      new PrismaKnowledgeStore(),
      new PrismaEnrichmentFactsReader(),
    );
  }

  it("két kézi bizonyíték ütközik, az elfogadott tény értéke NULL, és a JEV eredményre mutat", async () => {
    const service = knowledge();
    const actor = { id: userId };
    const daily = await service.addEvidence(
      productId,
      {
        field: "dosing",
        raw: "1 Tropfen je 100 Liter /Tag",
        value: "1 drop/100 L/day",
        url: "https://gyarto.example.invalid/amino",
        sourceType: "MANUFACTURER_PAGE",
      },
      actor,
    );
    assert.equal(daily.status, "VERIFIED");
    const weekly = await service.addEvidence(
      productId,
      {
        field: "dosing",
        raw: "Korallenzucht dosage: 1-2 x/week 1 drop/100L",
        value: "1 drop/100 L, 1-2/week",
        url: "https://gyarto.example.invalid/dosage-2013.pdf",
        sourceType: "MANUFACTURER_DOCUMENT",
      },
      actor,
    );
    assert.equal(weekly.status, "CONFLICTING_SOURCES");

    // Two ordinary finished runs, one FETCHED manual fetch each.
    const runs = await prisma.productEnrichmentRun.findMany({
      where: { requestedById: userId },
      select: {
        status: true,
        requestLimit: true,
        products: { select: { fetches: { select: { outcome: true } } } },
      },
    });
    assert.deepEqual(
      runs.map((r) => [
        r.status,
        r.requestLimit,
        r.products[0]!.fetches.map((f) => f.outcome),
      ]),
      [
        ["COMPLETED", 0, ["FETCHED"]],
        ["COMPLETED", 0, ["FETCHED"]],
      ],
    );

    const view = await service.accept(productId, weekly.fieldResultId, actor);
    assert.deepEqual(
      view.facts.map((f) => [f.field, f.value, f.status, f.revision]),
      [["dosing", null, "CONFLICTING_SOURCES", 1]],
    );
    const stored = await prisma.productKnowledgeFact.findUniqueOrThrow({
      where: { productId_field: { productId, field: "dosing" } },
      select: { value: true, fieldResultId: true },
    });
    assert.equal(stored.value, null);
    assert.equal(stored.fieldResultId, weekly.fieldResultId);
    const pointed = await prisma.productEnrichmentFieldResult.findUniqueOrThrow(
      {
        where: { id: weekly.fieldResultId },
        select: { conflicts: true },
      },
    );
    assert.deepEqual(
      (pointed.conflicts as { value: string }[]).map((c) => c.value),
      ["1 drop/100 L/day", "1 drop/100 L, 1-2/week"],
    );
  });

  it("RESTRICT: az elfogadott tény mögötti futás nem törölhető, a tény nélkül igen", async () => {
    const fact = await prisma.productKnowledgeFact.findUniqueOrThrow({
      where: { productId_field: { productId, field: "dosing" } },
      select: {
        fieldResult: { select: { check: { select: { runId: true } } } },
      },
    });
    const runId = fact.fieldResult.check.runId;
    await assert.rejects(
      prisma.productEnrichmentRun.delete({ where: { id: runId } }),
      (error: unknown) =>
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2003",
    );
    assert.ok(
      await prisma.productEnrichmentRun.findUnique({ where: { id: runId } }),
      "the run must still be there",
    );
    await prisma.productKnowledgeFact.delete({
      where: { productId_field: { productId, field: "dosing" } },
    });
    await prisma.productEnrichmentRun.delete({ where: { id: runId } });
  });

  it("a felülvizsgálat mezőnként a legfrissebb eredményt olvassa: a kézi ellenőrzés nem takarja el a korábbit", async () => {
    // An earlier crawl-like check with two fields, then a manual one for a
    // third field: the review must show all three.
    await prisma.productEnrichmentRun.create({
      data: {
        requestedById: userId,
        status: "COMPLETED",
        productLimit: 1,
        requestLimit: 1,
        products: {
          create: {
            productId,
            checkedAt: new Date("2026-10-01T10:00:00.000Z"),
            sourceCount: 1,
            fieldCount: 2,
            fields: {
              create: ["ean", "brand"].map((field) => ({
                field,
                tier: "C",
                status: "MISSING",
                evidence: [],
              })),
            },
          },
        },
      },
    });
    await knowledge().addEvidence(
      productId,
      {
        field: "packSize",
        raw: "100 ml",
        value: "100 ml",
        url: "https://gyarto.example.invalid/amino",
        sourceType: "MANUFACTURER_PAGE",
      },
      { id: userId },
    );
    const check = await new PrismaEnrichmentReader().latestCheck(productId);
    assert.deepEqual(
      check?.fields.map((f) => f.field),
      ["brand", "dosing", "ean", "packSize"],
    );
  });
});
