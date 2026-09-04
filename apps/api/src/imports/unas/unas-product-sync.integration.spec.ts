import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { ConflictException } from "@nestjs/common";
import { prisma } from "@acropora/database";
import type { UnasApiCategory, UnasApiProduct } from "@acropora/types";

import { ProductRepository } from "../../products/product.repository.js";

import type { UnasApiClient } from "./unas-api.client.js";
import { UnasProductCanonicalizer } from "./unas-product-canonicalizer.js";
import { UnasProductSyncDiffEngine } from "./unas-product-sync-diff.engine.js";
import { UnasProductSyncRepository } from "./unas-product-sync.repository.js";
import { UnasProductSyncService } from "./unas-product-sync.service.js";
import { integrationDatabaseGate } from "../../common/integration-database.js";

// This suite writes and deletes rows, so it runs only against a database named
// for testing; see integrationDatabaseGate.
const gate = integrationDatabaseGate(process.env);
const enabled = gate.mode !== "skip";

const product = (
  sku: string,
  overrides: {
    externalId?: string;
    name?: string;
    description?: string;
    primaryCategoryExternalId?: string;
  } = {},
): UnasApiProduct => ({
  externalId: overrides.externalId ?? "159850145",
  sku,
  name: overrides.name ?? "Integration Reef Pump",
  state: "live",
  externalStatus: "1",
  sourceCreatedAt: "2026-07-20T08:00:00.000Z",
  sourceUpdatedAt: "2026-07-20T09:00:00.000Z",
  descriptionShort: overrides.description ?? "Integration fixture",
  descriptionLong: null,
  descriptionShortIsHtml: false,
  descriptionLongIsHtml: null,
  unit: "db",
  secondaryUnit: "karton",
  secondaryUnitFactor: "12",
  manufacturerPartNumber: "INT-MPN-1",
  brandName: null,
  vatRate: "27",
  netPrice: "1000",
  grossPrice: "1270",
  saleNetPrice: null,
  saleGrossPrice: null,
  saleStartsAt: null,
  saleEndsAt: null,
  priceDisplay: "normal",
  minimumOrderQuantity: "1",
  maximumOrderQuantity: null,
  lowStockThreshold: "2",
  orderQuantityStep: "1",
  backorderAllowed: true,
  variantStockEnabled: false,
  reportedStock: "7.5",
  variantStocks: [],
  isPackageProduct: false,
  packageComponents: [],
  productUrl: "https://example.test/integration-pump",
  sefUrl: "integration-pump",
  manufacturerUrl: null,
  primaryCategoryExternalId: overrides.primaryCategoryExternalId ?? "10",
  alternativeCategoryExternalIds: [],
  images: [
    {
      type: "base",
      id: "1",
      sefUrl: "https://example.test/integration-pump.jpg",
      filename: "integration-pump.jpg",
      alt: "Integration pump",
    },
  ],
  parameters: [],
  seo: {
    title: "Integration pump",
    description: null,
    keywords: null,
    robots: null,
  },
  rawPayload: { Id: overrides.externalId ?? "159850145", Sku: sku },
});

const category: UnasApiCategory = {
  externalId: "10",
  name: "Integration pumps",
  state: "live",
  parentExternalId: null,
  sortOrder: 1,
  sourceCreatedAt: "2026-07-20T08:00:00.000Z",
  sourceUpdatedAt: "2026-07-20T09:00:00.000Z",
  rawPayload: { Id: "10", Name: "Integration pumps" },
};

/** A second live category, so a product can be moved from one to another. */
const otherCategory: UnasApiCategory = {
  externalId: "20",
  name: "Integration skimmers",
  state: "live",
  parentExternalId: null,
  sortOrder: 2,
  sourceCreatedAt: "2026-07-20T08:00:00.000Z",
  sourceUpdatedAt: "2026-07-20T09:00:00.000Z",
  rawPayload: { Id: "20", Name: "Integration skimmers" },
};

const deletedParentCategory: UnasApiCategory = {
  externalId: "9",
  name: "Discontinued line",
  state: "deleted",
  parentExternalId: null,
  sortOrder: 0,
  sourceCreatedAt: "2026-07-20T08:00:00.000Z",
  sourceUpdatedAt: "2026-07-20T09:00:00.000Z",
  rawPayload: { Id: "9", Name: "Discontinued line" },
};

const liveChildOfDeletedParent: UnasApiCategory = {
  externalId: "11",
  name: "Integration pumps (sub)",
  state: "live",
  parentExternalId: "9",
  sortOrder: 1,
  sourceCreatedAt: "2026-07-20T08:00:00.000Z",
  sourceUpdatedAt: "2026-07-20T09:00:00.000Z",
  rawPayload: { Id: "11", Name: "Integration pumps (sub)" },
};

async function cleanup() {
  await prisma.auditLog.deleteMany({
    where: { entityType: "ProductExtension" },
  });
  await prisma.domainEvent.deleteMany({
    where: { correlationId: { not: null } },
  });
  await prisma.integrationCursor.deleteMany({
    where: { provider: "UNAS", stream: { in: ["PRODUCTS", "STOCKS"] } },
  });
  await prisma.unasProductSyncRun.deleteMany();
  await prisma.externalReference.deleteMany({ where: { system: "UNAS" } });
  await prisma.product.deleteMany();
  await prisma.category.deleteMany();
}

describe("UNAS Product Sync database integration", { skip: !enabled }, () => {
  let liveProducts = [product("INTEGRATION-SKU-1")];
  let deletedProducts: UnasApiProduct[] = [];
  let categoryPage: UnasApiCategory[] = [category];
  const api = {
    getCategoryPage: async (_token: string, request: { limitStart: number }) =>
      request.limitStart === 0 ? categoryPage : [],
    getProductPage: async (
      _token: string,
      request: { limitStart: number; state?: "live" | "deleted" },
    ) => {
      if (request.limitStart !== 0) return [];
      return request.state === "deleted" ? deletedProducts : liveProducts;
    },
    getStockPage: async () => [],
  } as unknown as UnasApiClient;
  const repository = new UnasProductSyncRepository();
  const service = new UnasProductSyncService(
    api,
    new UnasProductCanonicalizer(),
    new UnasProductSyncDiffEngine(),
    repository,
  );

  before(async () => {
    if (gate.mode === "refuse") throw new Error(gate.reason);
    await cleanup();
  });

  after(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("creates a mirror, preserves extension and never writes inventory", async () => {
    const first = await service.runIncremental(
      "integration-token",
      new Date("2026-07-20T10:00:00.000Z"),
      100,
    );
    assert.equal(first.counts.CREATE, 1);
    const variant = await prisma.productVariant.findUniqueOrThrow({
      where: { sku: "INTEGRATION-SKU-1" },
      include: { product: { include: { unasSnapshot: true } } },
    });
    assert.equal(variant.product.origin, "UNAS");
    assert.equal(variant.product.catalogAuthority, "UNAS");
    assert.equal(variant.product.mirrorSource, "UNAS");
    assert.equal(variant.product.mirrorState, "ACTIVE");
    assert.equal(
      variant.product.unasSnapshot?.reportedStock?.toString(),
      "7.5",
    );
    /**
     * CSAK A SAJÁT KÉT FOLYAMA, nem az egész tábla.
     *
     * A kurzor-tábla KÖZÖS: ugyanide ír a rendelés-szinkron is (`ORDERS`).
     * Amíg a szűrő csak a szolgáltatóra szólt, ez az állítás a MÁSIK suite
     * nyomát is beleszámolta, és attól bukott el -- nem a mért viselkedéstől.
     *
     * Miért nem látszott soha: a CI mindig FRISS adatbázison indul, ahol nincs
     * idegen sor. Csak az bukik bele, aki helyben, ismételten futtat, tehát
     * pontosan az, aki épp fejleszt. (Mérve 2026-08-26: a suite első futása
     * zöld, a második három bukást adott, és a különbség egyetlen `ORDERS` sor
     * volt az előző futásból.)
     */
    const cursors = await prisma.integrationCursor.findMany({
      where: { provider: "UNAS", stream: { in: ["PRODUCTS", "STOCKS"] } },
      select: { stream: true, lastSuccessfulWindowEnd: true },
      orderBy: { stream: "asc" },
    });
    assert.deepEqual(
      cursors.map((cursor) => ({
        stream: cursor.stream,
        lastSuccessfulWindowEnd:
          cursor.lastSuccessfulWindowEnd?.toISOString() ?? null,
      })),
      [
        {
          stream: "PRODUCTS",
          lastSuccessfulWindowEnd: "2026-07-20T10:00:00.000Z",
        },
        {
          stream: "STOCKS",
          lastSuccessfulWindowEnd: "2026-07-20T10:00:00.000Z",
        },
      ],
    );
    await prisma.productExtension.create({
      data: {
        variantId: variant.id,
        defaultPurchaseCurrency: "EUR",
        reorderPoint: "3",
      },
    });

    const eventCount = await prisma.domainEvent.count();
    const repeated = await service.runIncremental(
      "integration-token",
      new Date("2026-07-20T11:00:00.000Z"),
      100,
    );
    assert.equal(repeated.counts.UNCHANGED, 1);
    assert.equal(await prisma.domainEvent.count(), eventCount);
    assert.equal(await prisma.product.count(), 1);
    assert.equal(await prisma.stockMovement.count(), 0);
    assert.equal(await prisma.stockItem.count(), 0);
  });

  it("updates SKU by stable UNAS ID without replacing Acropora extension", async () => {
    liveProducts = [product("INTEGRATION-SKU-RENAMED")];
    const result = await service.runIncremental(
      "integration-token",
      new Date("2026-07-20T12:00:00.000Z"),
      100,
    );
    assert.equal(result.counts.UPDATE, 1);
    const variant = await prisma.productVariant.findUniqueOrThrow({
      where: { sku: "INTEGRATION-SKU-RENAMED" },
      include: { extension: true },
    });
    assert.equal(await prisma.product.count(), 1);
    assert.equal(variant.extension?.defaultPurchaseCurrency, "EUR");
    assert.equal(variant.extension?.reorderPoint?.toString(), "3");
  });

  it("marks an absent full-snapshot product missing and restores it", async () => {
    liveProducts = [];
    await prisma.integrationCursor.deleteMany({
      where: { provider: "UNAS", stream: "PRODUCTS" },
    });
    const missing = await service.runIncremental(
      "integration-token",
      new Date("2026-07-20T13:00:00.000Z"),
      100,
    );
    assert.equal(missing.missingCount, 1);
    assert.equal(
      (await prisma.product.findFirstOrThrow()).mirrorState,
      "MISSING",
    );

    liveProducts = [product("INTEGRATION-SKU-RENAMED")];
    const restored = await service.runIncremental(
      "integration-token",
      new Date("2026-07-20T14:00:00.000Z"),
      100,
    );
    assert.equal(restored.counts.UPDATE, 1);
    const productRecord = await prisma.product.findFirstOrThrow();
    assert.equal(productRecord.mirrorState, "ACTIVE");
    assert.equal(productRecord.missingSince, null);
    assert.equal(await prisma.productExtension.count(), 1);
  });

  it("materializes a deleted parent category so a live child can resolve its parentId", async () => {
    categoryPage = [category, deletedParentCategory, liveChildOfDeletedParent];
    await prisma.integrationCursor.deleteMany({
      where: { provider: "UNAS", stream: "PRODUCTS" },
    });

    await assert.doesNotReject(
      service.runIncremental(
        "integration-token",
        new Date("2026-07-20T16:00:00.000Z"),
        100,
      ),
    );

    const parentReference = await prisma.externalReference.findUniqueOrThrow({
      where: {
        system_entityType_externalId: {
          system: "UNAS",
          entityType: "Category",
          externalId: "9",
        },
      },
    });
    const childReference = await prisma.externalReference.findUniqueOrThrow({
      where: {
        system_entityType_externalId: {
          system: "UNAS",
          entityType: "Category",
          externalId: "11",
        },
      },
    });
    const child = await prisma.category.findUniqueOrThrow({
      where: { id: childReference.entityId },
    });
    assert.equal(child.parentId, parentReference.entityId);
    const parent = await prisma.category.findUniqueOrThrow({
      where: { id: parentReference.entityId },
    });
    assert.equal(parent.name, "Discontinued line");
  });

  it("retires the aggregate variant and materializes each UNAS stock combination", async () => {
    liveProducts = [
      {
        ...product("RF-BLUEM"),
        variantStockEnabled: true,
        reportedStock: null,
        variantStocks: [
          {
            values: [{ name: "Szín", value: "Fekete" }],
            reportedStock: "2",
          },
          {
            values: [{ name: "Szín", value: "Fehér" }],
            reportedStock: "3",
          },
        ],
      },
    ];
    await prisma.integrationCursor.deleteMany({
      where: { provider: "UNAS", stream: "PRODUCTS" },
    });

    await service.runIncremental(
      "integration-token",
      new Date("2026-07-20T17:00:00.000Z"),
      100,
    );

    const variants = await prisma.productVariant.findMany({
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    });
    const active = variants.filter((variant) => variant.isActive);
    assert.equal(active.length, 2);
    assert.deepEqual(
      active.map((variant) => ({
        baseSku: variant.unasBaseSku,
        reported: variant.unasReportedStock?.toString(),
      })),
      [
        { baseSku: "RF-BLUEM", reported: "3" },
        { baseSku: "RF-BLUEM", reported: "2" },
      ],
    );
    assert.equal(
      variants.some(
        (variant) => !variant.isActive && variant.unasVariantKey === null,
      ),
      true,
    );
  });

  it("rejects a concurrent run with a database-level conflict", async () => {
    const runId = await repository.createRun({
      kind: "INCREMENTAL",
      windowStart: new Date("2026-07-20T14:00:00.000Z"),
      windowEnd: new Date("2026-07-20T15:00:00.000Z"),
    });
    await assert.rejects(
      service.runIncremental(
        "integration-token",
        new Date("2026-07-20T15:00:00.000Z"),
        100,
      ),
      ConflictException,
    );
    await repository.markFailed(runId, "INTEGRATION_TEST_CLEANUP");
  });

  /**
   * The first controlled authority handover, measured end to end.
   *
   * The proof has to be capable of failing, so both products travel in the
   * SAME batch and the same sync run: one still owned by the webshop, one
   * taken over by us. If the skip stopped working, the taken-over product's
   * name and description would come back overwritten and this test would go
   * red. If the skip were too broad, the webshop-owned product would stop
   * updating and the UPDATE count would drop - which is why both halves are
   * asserted, not just the one the feature is named after.
   *
   * `name` and `description` are the fields under test because they are the
   * first ones whose ownership moves to Acropora OS. Stock and pricing are
   * deliberately untouched here: they are separate domains, and this batch
   * carries no stock rows at all.
   */
  it("keeps the webshop out of a product we took over, in a mixed batch", async () => {
    await cleanup();
    deletedProducts = [];
    categoryPage = [category];

    const ours = () =>
      product("AUTHORITY-OURS", {
        externalId: "900001",
        name: "Acropora névvel",
        description: "Acropora leírással",
      });
    const theirs = () =>
      product("AUTHORITY-THEIRS", {
        externalId: "900002",
        name: "UNAS névvel",
        description: "UNAS leírással",
      });

    liveProducts = [ours(), theirs()];
    const created = await service.runIncremental(
      "integration-token",
      new Date("2026-07-21T10:00:00.000Z"),
      100,
    );
    assert.equal(created.counts.CREATE, 2);
    assert.equal(created.skippedCount, 0);

    // The handover goes through the same operation the screen calls, so this
    // measures the shipped path and not a hand-written UPDATE.
    const takenOver = await prisma.productVariant.findUniqueOrThrow({
      where: { sku: "AUTHORITY-OURS" },
      select: { productId: true },
    });
    const transfer = await new ProductRepository().takeCatalogAuthority(
      takenOver.productId,
      undefined,
    );
    assert.equal(transfer.changed, true);
    assert.equal(transfer.product.catalogAuthority, "ACROPORA");

    // Somebody edits the name and the description on OUR side. Nothing in
    // the sync knows about this; the webshop keeps sending its own values.
    await prisma.product.update({
      where: { id: takenOver.productId },
      data: {
        name: "Kézzel javított név",
        description: "Kézzel javított leírás",
      },
    });

    liveProducts = [
      product("AUTHORITY-OURS", {
        externalId: "900001",
        name: "UNAS felülírná",
        description: "UNAS leírása felülírná",
      }),
      product("AUTHORITY-THEIRS", {
        externalId: "900002",
        name: "UNAS új neve",
        description: "UNAS új leírása",
      }),
    ];

    const second = await service.runIncremental(
      "integration-token",
      new Date("2026-07-21T11:00:00.000Z"),
      100,
    );

    // One product was written, one was left alone, and the run says so.
    assert.equal(second.counts.UPDATE, 1);
    assert.equal(second.skippedCount, 1);

    const kept = await prisma.product.findUniqueOrThrow({
      where: { id: takenOver.productId },
      select: { name: true, description: true, catalogAuthority: true },
    });
    assert.equal(kept.name, "Kézzel javított név");
    assert.equal(kept.description, "Kézzel javított leírás");
    assert.equal(kept.catalogAuthority, "ACROPORA");

    const stillTheirs = await prisma.productVariant.findUniqueOrThrow({
      where: { sku: "AUTHORITY-THEIRS" },
      select: {
        product: {
          select: { name: true, description: true, catalogAuthority: true },
        },
      },
    });
    assert.equal(stillTheirs.product.name, "UNAS új neve");
    assert.equal(stillTheirs.product.description, "UNAS új leírása");
    assert.equal(stillTheirs.product.catalogAuthority, "UNAS");

    // The run row carries the same number, so the evidence survives the
    // process that produced it.
    const run = await prisma.unasProductSyncRun.findUniqueOrThrow({
      where: { id: second.runId },
      select: {
        skippedCount: true,
        skippedSourceChangedCount: true,
        updatedCount: true,
      },
    });
    assert.equal(run.skippedCount, 1);
    assert.equal(run.updatedCount, 1);

    /**
     * A KIHAGYÁS ÖNMAGÁBAN NEM MOND SEMMIT, EZ A SZÁM IGEN.
     *
     * Itt a webshop MEGVÁLTOZTATTA a mi termékünk nevét és leírását, és a
     * változás nem jött át. Ez az elavulás pillanata, és ez az egyetlen szám,
     * ami erről tud: a `skippedCount` ugyanennyi lenne akkor is, ha a boltban
     * hozzá sem nyúltak volna.
     */
    assert.equal(second.skippedSourceChangedCount, 1);
    assert.equal(run.skippedSourceChangedCount, 1);
  });

  /**
   * A KÉT KIHAGYÁS-FAJTA SZÉTVÁLASZTÁSA, MINDKÉT IRÁNYBÓL.
   *
   * Egy szám, ami minden futásnál ugyanaz, nem jelzés, hanem alapzaj. A
   * `skippedCount` pontosan ilyen: az átvett termék MINDEN futásból kimarad,
   * akkor is, ha a boltban hozzá sem nyúltak.
   *
   * Ez a teszt ezért ugyanazon az egy termékan méri mind a két esetet: előbb
   * változatlan forrással (a kihagyás állandó, az esemény nulla), utána
   * megváltoztatott forrással (a kihagyás ugyanannyi, az esemény egy). Ha
   * valaki egyszer összevonja a két számot, ez a sor pirosodik.
   */
  it("separates a skip that changed nothing from a skip that lost a change", async () => {
    await cleanup();
    deletedProducts = [];
    categoryPage = [category];

    const ours = () =>
      product("DRIFT-OURS", {
        externalId: "910001",
        name: "Eredeti név",
        description: "Eredeti leírás",
      });

    liveProducts = [ours()];
    await service.runIncremental(
      "integration-token",
      new Date("2026-07-22T10:00:00.000Z"),
      100,
    );

    const taken = await prisma.productVariant.findUniqueOrThrow({
      where: { sku: "DRIFT-OURS" },
      select: { productId: true },
    });
    await new ProductRepository().takeCatalogAuthority(
      taken.productId,
      undefined,
    );

    // ELSŐ eset: a bolt NEM nyúlt hozzá. Kihagyjuk, de nincs mit elmulasztani.
    liveProducts = [ours()];
    const quiet = await service.runIncremental(
      "integration-token",
      new Date("2026-07-22T11:00:00.000Z"),
      100,
    );
    assert.equal(quiet.skippedCount, 1);
    assert.equal(quiet.skippedSourceChangedCount, 0);

    // MÁSODIK eset: ugyanaz a termék, ugyanaz a kihagyás - de a boltban
    // átírták. A `skippedCount` nem mozdul, az esemény-szám igen.
    liveProducts = [
      product("DRIFT-OURS", {
        externalId: "910001",
        name: "A boltban átírt név",
        description: "A boltban átírt leírás",
      }),
    ];
    const drifted = await service.runIncremental(
      "integration-token",
      new Date("2026-07-22T12:00:00.000Z"),
      100,
    );
    assert.equal(drifted.skippedCount, quiet.skippedCount);
    assert.equal(drifted.skippedSourceChangedCount, 1);

    // És a futás sora is ezt hordozza, nem csak a válasz.
    const row = await prisma.unasProductSyncRun.findUniqueOrThrow({
      where: { id: drifted.runId },
      select: { skippedCount: true, skippedSourceChangedCount: true },
    });
    assert.equal(row.skippedCount, 1);
    assert.equal(row.skippedSourceChangedCount, 1);
  });

  /**
   * The category follows the same owner as the name and the description.
   *
   * It is worth its own test because the sync writes it by a DIFFERENT route:
   * the name and the description go in with the product row itself, while the
   * category is written afterwards, in two more statements - the `ProductCategory`
   * links are deleted and recreated, and `Product.categoryId` is set separately.
   * Three writes, one owner: if the skip only covered the first one, a taken-over
   * product would keep its name and quietly lose its category.
   *
   * Falsifiable the same way as the previous test: both products travel in one
   * batch and one run, and BOTH halves are asserted. A sync that stopped writing
   * categories altogether would pass a test that only looked at the taken-over
   * product.
   */
  it("leaves the category of a taken-over product alone, and moves the other one", async () => {
    await cleanup();
    deletedProducts = [];
    categoryPage = [category, otherCategory];

    liveProducts = [
      product("CATEGORY-OURS", { externalId: "900011" }),
      product("CATEGORY-THEIRS", { externalId: "900012" }),
    ];
    const created = await service.runIncremental(
      "integration-token",
      new Date("2026-07-22T10:00:00.000Z"),
      100,
    );
    assert.equal(created.counts.CREATE, 2);

    const skimmers = await prisma.category.findFirstOrThrow({
      where: { name: "Integration skimmers" },
      select: { id: true },
    });
    const pumps = await prisma.category.findFirstOrThrow({
      where: { name: "Integration pumps" },
      select: { id: true },
    });

    const ours = await prisma.productVariant.findUniqueOrThrow({
      where: { sku: "CATEGORY-OURS" },
      select: { productId: true },
    });
    await new ProductRepository().takeCatalogAuthority(ours.productId);

    // Somebody re-files the product on our side. UNAS knows nothing about it
    // and keeps sending the category it has always sent.
    await prisma.product.update({
      where: { id: ours.productId },
      data: { categoryId: skimmers.id, name: "Kézzel átsorolva" },
    });

    liveProducts = [
      product("CATEGORY-OURS", {
        externalId: "900011",
        name: "UNAS visszasorolná",
        primaryCategoryExternalId: "10",
      }),
      product("CATEGORY-THEIRS", {
        externalId: "900012",
        name: "UNAS átsorolja",
        primaryCategoryExternalId: "20",
      }),
    ];

    const second = await service.runIncremental(
      "integration-token",
      new Date("2026-07-22T11:00:00.000Z"),
      100,
    );
    // The category is asserted BEFORE the counters, deliberately: this test is
    // named after the category, and a counter assertion that trips first would
    // report the wrong thing about the wrong subject.
    const kept = await prisma.product.findUniqueOrThrow({
      where: { id: ours.productId },
      select: { categoryId: true, name: true },
    });
    assert.equal(kept.categoryId, skimmers.id);
    assert.equal(kept.name, "Kézzel átsorolva");

    assert.equal(second.counts.UPDATE, 1);
    assert.equal(second.skippedCount, 1);

    // The UNAS-side link rows are written by their own statements, so they are
    // asserted separately: the taken-over product must still carry the category
    // it was filed under here, and not the one UNAS keeps sending.
    const keptLinks = await prisma.productCategory.findMany({
      where: { productId: ours.productId },
      select: { categoryId: true, isPrimary: true },
    });
    assert.equal(keptLinks.length, 1);
    assert.equal(keptLinks[0]?.categoryId, pumps.id);

    const moved = await prisma.productVariant.findUniqueOrThrow({
      where: { sku: "CATEGORY-THEIRS" },
      select: {
        product: { select: { id: true, categoryId: true, name: true } },
      },
    });
    assert.equal(moved.product.categoryId, skimmers.id);
    assert.equal(moved.product.name, "UNAS átsorolja");

    const movedLinks = await prisma.productCategory.findMany({
      where: { productId: moved.product.id },
      select: { categoryId: true, isPrimary: true },
    });
    assert.equal(movedLinks.length, 1);
    assert.equal(movedLinks[0]?.categoryId, skimmers.id);
    assert.equal(movedLinks[0]?.isPrimary, true);
  });

  /**
   * A TORLES ELES AGA. A masik torles-teszt ("marks an absent full-snapshot
   * product missing") a TELJES osszevetest meri, es ahhoz maga torli a
   * kurzort - mert a FULL futas csak kurzor nelkul all elo
   * (`kind: cursor ? "INCREMENTAL" : "FULL"`, egyetlen hely a szolgaltatasban,
   * reset es kezi inditas nelkul). Vagyis egy egyszer felallt rendszerben az
   * az ag SOHA TOBBE nem fut le.
   *
   * Elesben tehat a torlest kizarolag a `state: "deleted"` lehivas hozza, es az
   * az ut eddig NULLA teszttel allt: a deletedProducts minden fixturaban ures
   * volt.
   */
  it("marks a product missing from the deleted-state download alone, on an incremental run", async () => {
    await cleanup();
    categoryPage = [category];
    deletedProducts = [];

    liveProducts = [product("DELETED-STATE-SKU", { externalId: "900021" })];
    const created = await service.runIncremental(
      "integration-token",
      new Date("2026-07-23T10:00:00.000Z"),
      100,
    );
    assert.equal(created.counts.CREATE, 1);
    const mirrored = await prisma.productVariant.findUniqueOrThrow({
      where: { sku: "DELETED-STATE-SKU" },
      select: { productId: true },
    });

    /**
     * A KONTROLL, ami nelkul a teszt mast merne, mint a neve.
     *
     * Egy ures `live` lista onmagaban NEM tesz semmit egy inkrementalis
     * futasban - a hianyt csak a teljes osszevetes venne eszre, es az itt nem
     * fut. Enelkul a lepes nelkul nem lehetne megmondani, hogy a lenti MISSING
     * a torles-listatol jott-e, vagy attol, hogy a termek kimaradt a live
     * ablakbol.
     */
    liveProducts = [];
    const quiet = await service.runIncremental(
      "integration-token",
      new Date("2026-07-23T11:00:00.000Z"),
      100,
    );
    assert.equal(quiet.missingCount, 0);
    assert.equal(
      (
        await prisma.product.findUniqueOrThrow({
          where: { id: mirrored.productId },
          select: { mirrorState: true },
        })
      ).mirrorState,
      "ACTIVE",
    );

    // Es most ugyanaz a futas, egyetlen kulonbseggel: a termek megjelenik a
    // torolt allapotu lehivasban.
    deletedProducts = [product("DELETED-STATE-SKU", { externalId: "900021" })];
    const removed = await service.runIncremental(
      "integration-token",
      new Date("2026-07-23T12:00:00.000Z"),
      100,
    );
    assert.equal(removed.missingCount, 1);
    const gone = await prisma.product.findUniqueOrThrow({
      where: { id: mirrored.productId },
      select: { mirrorState: true, missingSince: true },
    });
    assert.equal(gone.mirrorState, "MISSING");
    assert.notEqual(gone.missingSince, null);

    // A torles nyoma esemenykent is megjelenik, kulonben a mirrorState egy
    // nema mezo marad, amirol utolag nem lehet megmondani, mikor es mitol
    // valtozott.
    const event = await prisma.domainEvent.findFirst({
      where: {
        eventType: "unas-product.missing",
        aggregateId: mirrored.productId,
      },
      select: { id: true },
    });
    assert.notEqual(event, null);

    deletedProducts = [];
  });
});
