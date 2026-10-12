import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { nincsMaradek } from "../../common/takaritas-leltar.js";
import { PrismaEnrichmentReader } from "./enrichment-read.repository.js";
import { runEnrichment } from "./enrichment-run.js";
import {
  PrismaEnrichmentFactsReader,
  PrismaEnrichmentRunStore,
} from "./enrichment-run.store.js";
import {
  fakeClock,
  productPage,
  scriptedNetwork,
} from "./enrichment-test-fixtures.js";

/**
 * A FUTÁS UTÁN A TERMÉK BÁJTRA UGYANAZ (PD-013 kalibráció), ADATBÁZISON.
 *
 * A futás valódi Prisma-tárolóval és -olvasóval fut, kitalált oldalakkal. A
 * termék sora, változata, vonalkódja, márkája és a beszállító előtte és utána
 * JSON-ra írva azonos kell legyen. Ugyanitt a sor-végpont valódi SQL-je
 * (legutóbbi ellenőrzés termékenként, szűrő, számlálás) is lefut.
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = "JEV-INT-";
const EMAIL_DOMAIN = "jev-enrichment-integration.invalid";

describe(
  "JEV termékellenőrzés, árnyékban, adatbázison",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = Date.now() % 1_000_000;
    let productId = "";
    let supplierId = "";
    let userId = "";

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      const user = await prisma.user.create({
        data: {
          email: `runner-${suffix}@${EMAIL_DOMAIN}`,
          displayName: "Kitalált Futtató",
          role: "OWNER",
          isActive: true,
        },
      });
      userId = user.id;
      const brand = await prisma.brand.create({
        data: {
          name: `${PREFIX}Márka ${suffix}`,
          normalizedName: `${PREFIX.toLowerCase()}marka-${suffix}`,
          slug: `${PREFIX.toLowerCase()}marka-${suffix}`,
          websiteUrl: "https://gyarto.example.invalid",
        },
      });
      const product = await prisma.product.create({
        data: { name: `${PREFIX}Pumpa ${suffix}`, brandId: brand.id },
      });
      productId = product.id;
      const variant = await prisma.productVariant.create({
        data: {
          productId,
          sku: `${PREFIX}SKU-${suffix}`,
          manufacturerPartNumber: "KP-3000",
        },
      });
      await prisma.productBarcode.create({
        data: {
          variantId: variant.id,
          code: `590123412345${suffix % 10}`.slice(0, 13),
          isPrimary: true,
        },
      });
      const supplier = await prisma.supplier.create({
        data: {
          code: `${PREFIX}${suffix}`,
          name: `${PREFIX}Beszállító`,
          websiteUrl: "https://beszallito.example.invalid",
        },
      });
      supplierId = supplier.id;
    });

    after(removeLeftovers);

    async function removeLeftovers() {
      await prisma.productEnrichmentRun.deleteMany({
        where: { requestedBy: { email: { endsWith: EMAIL_DOMAIN } } },
      });
      await prisma.productBarcode.deleteMany({
        where: { variant: { sku: { startsWith: PREFIX } } },
      });
      await prisma.productVariant.deleteMany({
        where: { sku: { startsWith: PREFIX } },
      });
      await prisma.product.deleteMany({
        where: { name: { startsWith: PREFIX } },
      });
      await prisma.brand.deleteMany({
        where: { name: { startsWith: PREFIX } },
      });
      await prisma.supplier.deleteMany({
        where: { code: { startsWith: PREFIX } },
      });
      await prisma.user.deleteMany({
        where: { email: { endsWith: EMAIL_DOMAIN } },
      });
      nincsMaradek([
        {
          nev: "ProductEnrichmentRun",
          darab: await prisma.productEnrichmentRun.count({
            where: { requestedBy: { email: { endsWith: EMAIL_DOMAIN } } },
          }),
        },
        {
          nev: "ProductEnrichmentRunProduct",
          darab: await prisma.productEnrichmentRunProduct.count({
            where: { product: { name: { startsWith: PREFIX } } },
          }),
        },
        {
          nev: "ProductVariant",
          darab: await prisma.productVariant.count({
            where: { sku: { startsWith: PREFIX } },
          }),
        },
        {
          nev: "Product",
          darab: await prisma.product.count({
            where: { name: { startsWith: PREFIX } },
          }),
        },
        {
          nev: "Brand",
          darab: await prisma.brand.count({
            where: { name: { startsWith: PREFIX } },
          }),
        },
        {
          nev: "Supplier",
          darab: await prisma.supplier.count({
            where: { code: { startsWith: PREFIX } },
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

    /** Everything a run could conceivably touch, as text. */
    async function snapshot(): Promise<string> {
      const product = await prisma.product.findUnique({
        where: { id: productId },
        include: {
          brand: true,
          unasSnapshot: true,
          variants: {
            include: {
              barcodes: true,
              supplierProducts: true,
              extension: true,
            },
          },
        },
      });
      const supplier = await prisma.supplier.findUnique({
        where: { id: supplierId },
      });
      return JSON.stringify({ product, supplier });
    }

    it("a futás tárol, a termék, a változat, a vonalkód, a márka és a beszállító bájtra ugyanaz", async () => {
      const before = await snapshot();
      const network = scriptedNetwork({
        "https://gyarto.example.invalid/p/1": {
          status: 200,
          body: productPage({
            mpn: "KP-3000",
            additionalProperty: [
              { name: "Flow rate", value: 3000, unitText: "l/h" },
            ],
          }),
        },
        "https://beszallito.example.invalid/p/1": {
          status: 200,
          body: productPage({
            mpn: "KP-3000",
            additionalProperty: [
              { name: "Flow rate", value: 2500, unitText: "l/h" },
            ],
          }),
        },
      });
      const clock = fakeClock();
      const summary = await runEnrichment(
        [
          {
            productId,
            sources: [
              {
                kind: "MANUFACTURER",
                url: "https://gyarto.example.invalid/p/1",
              },
              {
                kind: "SUPPLIER",
                supplierId,
                url: "https://beszallito.example.invalid/p/1",
              },
            ],
          },
        ],
        { requestedById: userId, productLimit: 5, requestLimit: 20 },
        {
          store: new PrismaEnrichmentRunStore(),
          facts: new PrismaEnrichmentFactsReader(),
          fetch: network.fetch,
          sleep: clock.sleep,
          now: clock.now,
        },
      );
      assert.equal(summary.status, "COMPLETED");
      assert.equal(
        await snapshot(),
        before,
        "the product side must not change by a byte",
      );

      const reader = new PrismaEnrichmentReader();
      const check = await reader.latestCheck(productId);
      assert.ok(check);
      const fields = Object.fromEntries(check.fields.map((f) => [f.field, f]));
      assert.equal(fields.manufacturerSku!.status, "VERIFIED");
      assert.equal(fields.flowRate!.status, "CONFLICTING_SOURCES");

      const latest = await reader.latestFieldResults();
      const ours = latest
        .filter((row) => row.productId === productId)
        .map((row) => row.id);
      assert.deepEqual(
        [...ours].sort(),
        check.fields.map((f) => f.id).sort(),
        "the queue reads exactly the review's rows",
      );
      const critical = await reader.queueRows(ours, "critical", null, 10);
      assert.deepEqual(
        critical.map((r) => [r.field, r.status]),
        [["flowRate", "CONFLICTING_SOURCES"]],
      );
      const counts = await reader.queueCounts(ours);
      assert.equal(
        counts.reduce((sum, c) => sum + c.count, 0),
        check.fields.length,
      );
    });

    // the water-effects run, 2026-10-12: batch 3 stopped on P2000, a fetch
    // reason (the lexicon notes) longer than its VARCHAR(64)
    const runOptions = () => ({
      requestedById: userId,
      productLimit: 5,
      requestLimit: 20,
    });
    const oneFetchCheck = (checkedAt: Date, reason: string | null) => ({
      productId,
      checkedAt,
      sourceCount: 1,
      fieldCount: 0,
      fetches: [
        {
          sourceKind: "MANUFACTURER" as const,
          url: "https://gyarto.example.invalid/p/2",
          outcome: "FETCHED" as const,
          reason,
          httpStatus: 200,
          fetchedAt: checkedAt,
          fieldCount: 0,
        },
      ],
      fields: [],
    });
    const finished = {
      status: "COMPLETED" as const,
      productCount: 1,
      requestCount: 1,
      errorCode: null,
    };

    it("JEV-RUN-LONG-REASON: a lap-megjegyzés a régi 64 jelnél hosszabb is lehet, és egészben tárolódik", async () => {
      const store = new PrismaEnrichmentRunStore();
      const notes = Array.from(
        { length: 6 },
        (_, i) =>
          `tagadva: KALCIUM:EMEL a ${i}. bekezdésben nem emeli a kalciumszintet`,
      ).join("; ");
      assert.ok(notes.length > 64, "longer than the old column");
      const run = await store.startRun(runOptions());
      await store.saveCheck(
        run,
        oneFetchCheck(new Date("2030-01-01T10:00:00Z"), notes),
      );
      await store.finishRun(run, finished);
      const stored = await prisma.productEnrichmentSourceFetch.findFirst({
        where: { check: { runId: run } },
        select: { reason: true },
      });
      assert.equal(stored?.reason, notes);
    });

    it("JEV-RUN-FAILED-ROW-SKIPPED: egy később tárolhatatlan termék sora nem lesz a legutóbbi ellenőrzés", async () => {
      const store = new PrismaEnrichmentRunStore();
      const okAt = new Date("2030-02-01T10:00:00Z");
      const okRun = await store.startRun(runOptions());
      await store.saveCheck(okRun, oneFetchCheck(okAt, null));
      await store.finishRun(okRun, finished);
      const failedRun = await store.startRun(runOptions());
      await store.saveFailure(failedRun, {
        productId,
        checkedAt: new Date("2030-02-02T10:00:00Z"),
        errorCode: "P2000",
      });
      await store.finishRun(failedRun, {
        ...finished,
        productCount: 0,
        errorCode: "1_PRODUCTS_FAILED",
      });
      const latest = await new PrismaEnrichmentReader().latestCheck(productId);
      assert.equal(latest?.checkedAt.toISOString(), okAt.toISOString());
    });
  },
);
