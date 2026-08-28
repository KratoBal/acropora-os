import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";
import type { ProductDatabase } from "./product.repository.js";
import { ProductRepository } from "./product.repository.js";
import type { ProductWithRelations } from "./product.types.js";

const product = {
  id: "product-1",
  name: "Reef Salt",
  description: null,
  type: "PHYSICAL",
  origin: "UNAS",
  catalogAuthority: "UNAS",
  createdById: null,
  brandId: null,
  categoryId: null,
  isActive: true,
  archivedAt: null,
  mirrorSource: "UNAS",
  mirrorState: "ACTIVE",
  sourceCreatedAt: new Date("2026-07-18T10:00:00.000Z"),
  sourceUpdatedAt: new Date("2026-07-20T09:00:00.000Z"),
  lastSyncedAt: new Date("2026-07-20T10:00:00.000Z"),
  missingSince: null,
  rawSourceHash: "hash",
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
      manufacturerPartNumber: "MPN-1",
      secondaryUnit: "karton",
      secondaryUnitFactor: new Prisma.Decimal("12"),
      isActive: true,
      createdAt: new Date("2026-07-19T10:00:00.000Z"),
      updatedAt: new Date("2026-07-19T10:00:00.000Z"),
      barcodes: [
        {
          id: "barcode-1",
          variantId: "variant-1",
          code: "5901234123457",
          isPrimary: true,
        },
      ],
      extension: {
        id: "extension-1",
        variantId: "variant-1",
        preferredSupplierId: null,
        defaultPurchaseCurrency: "EUR",
        defaultWarehouseId: null,
        defaultLocationId: null,
        minimumStock: new Prisma.Decimal("2"),
        optimalStock: new Prisma.Decimal("8"),
        reorderPoint: new Prisma.Decimal("3"),
        safetyStock: new Prisma.Decimal("1"),
        lastPurchaseNetPrice: null,
        lastPurchaseVatRate: null,
        stockTrackingEnabled: true,
        purchasingDisabled: false,
        phaseOut: false,
        autoReorderEnabled: true,
        internalNote: "Belső adat",
        createdAt: new Date("2026-07-19T10:00:00.000Z"),
        updatedAt: new Date("2026-07-20T08:00:00.000Z"),
      },
      stockItems: [
        {
          id: "stock-1",
          variantId: "variant-1",
          warehouseId: "wh-1",
          locationId: null,
          lotId: null,
          onHand: new Prisma.Decimal("6"),
          reserved: new Prisma.Decimal("0"),
          updatedAt: new Date("2026-07-20T08:00:00.000Z"),
        },
      ],
    },
  ],
  unasSnapshot: {
    currency: "HUF",
    netPrice: new Prisma.Decimal("1000"),
    grossPrice: new Prisma.Decimal("1270"),
    saleNetPrice: null,
    saleGrossPrice: null,
    saleStartsAt: null,
    saleEndsAt: null,
    priceDisplay: "normal",
    productUrl: "https://shop.example/reef-salt",
    manufacturerUrl: null,
    minimumOrderQuantity: new Prisma.Decimal("1"),
    maximumOrderQuantity: null,
    orderQuantityStep: new Prisma.Decimal("1"),
    lowStockThreshold: new Prisma.Decimal("2"),
    backorderAllowed: true,
    variantStockEnabled: false,
    reportedStock: new Prisma.Decimal("7.5"),
    reportedStockSyncedAt: new Date("2026-07-20T10:00:00.000Z"),
  },
} as unknown as ProductWithRelations;

/**
 * `authorityUpdateCount` is how many rows the conditional authority update
 * touches. It is a parameter and not a constant because the two outcomes are
 * different behaviours, not different data: one row means this call performed
 * the transfer, zero means somebody (or something) got there first.
 */
function createDatabase({ authorityUpdateCount = 1 } = {}) {
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
      updateMany: async (args: unknown) => {
        calls.push({ operation: "productUpdateMany", args });
        return { count: authorityUpdateCount };
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
    aiProductSearchDocument: {
      upsert: async (args: unknown) => {
        calls.push({ operation: "searchDocumentUpsert", args });
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
    externalReference: {
      findFirst: async () => ({ externalId: "159850145" }),
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

    /**
     * A KERESESI DOKUMENTUM UGYANEBBEN A TRANZAKCIOBAN KESZUL.
     *
     * A ket utolso muvelet nem diszites a sorban: a `transactionFind` az iro
     * olvasasa, a `searchDocumentUpsert` maga az iras - mindketto a
     * tranzakcio-kliensen, nem a kapcsolaton. Ha valaki kesobb kiviszi a
     * tranzakciobol, ez a sor pirosodik.
     */
    assert.deepEqual(
      calls.map((call) => call.operation),
      ["create", "event", "transactionFind", "searchDocumentUpsert"],
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
        origin: string;
        catalogAuthority: string;
        createdById: string;
        categoryId: string;
        categories: { create: { isPrimary: boolean } };
      };
    };
    assert.equal(createArgs.data.origin, "LOCAL");
    assert.equal(createArgs.data.catalogAuthority, "ACROPORA");
    assert.equal(createArgs.data.createdById, "user-1");
    assert.equal(createArgs.data.categoryId, "category-1");
    assert.equal(createArgs.data.categories.create.isPrimary, true);
  });

  /**
   * The transfer is the moment the webshop sync stops writing this product,
   * so what matters is that the write is CONDITIONAL: it only touches a row
   * that is still UNAS-owned. Without the condition two parallel transfers
   * would both believe they did it, and the log would carry the same single
   * decision twice.
   */
  it("takes authority only from a row the webshop still owns", async () => {
    const { database, calls } = createDatabase();
    const repository = new ProductRepository(database);

    const result = await repository.takeCatalogAuthority("product-1", "user-1");

    assert.equal(result.changed, true);
    assert.deepEqual(
      calls.map((call) => call.operation),
      ["productUpdateMany", "event", "transactionFind"],
    );
    const updateArgs = calls[0]?.args as {
      where: { id: string; catalogAuthority: string };
      data: { catalogAuthority: string };
    };
    assert.equal(updateArgs.where.catalogAuthority, "UNAS");
    assert.equal(updateArgs.data.catalogAuthority, "ACROPORA");
    const eventArgs = calls[1]?.args as {
      data: { eventType: string; actorUserId: string; payload: unknown };
    };
    assert.equal(
      eventArgs.data.eventType,
      "product.catalog-authority.transferred",
    );
    assert.equal(eventArgs.data.actorUserId, "user-1");
    assert.deepEqual(eventArgs.data.payload, { from: "UNAS", to: "ACROPORA" });
  });

  /**
   * The other half, and the one a single test would miss: repeating the
   * transfer is not an error - the product is ours either way - but it must
   * not write a second event. A log that reports one decision twice is worse
   * than no log, because it invents a history nobody lived.
   */
  it("writes no event when the product was already ours", async () => {
    const { database, calls } = createDatabase({ authorityUpdateCount: 0 });
    const repository = new ProductRepository(database);

    const result = await repository.takeCatalogAuthority("product-1", "user-1");

    assert.equal(result.changed, false);
    assert.deepEqual(
      calls.map((call) => call.operation),
      ["productUpdateMany", "transactionFind"],
    );
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
        // A dokumentum a KATEGORIA-IRAS UTAN keszul, kulonben a facets sav
        // az elozo kategoriat vinne tovabb.
        "transactionFind",
        "searchDocumentUpsert",
        "transactionFind",
      ],
    );
  });

  /**
   * A VASAROLHATOSAG ELJUT A TERMEK SORAIG.
   *
   * A `webshopSellable` a fában eddig HAT helyen szerepelt, MIND OLVASASKENT
   * (medusa-projekcio, publikacios szabaly, cli, tesztek) -- semmi nem tudta
   * igazra allitani. A hianyzo lepes NEM a mezo volt, hanem az iras: a
   * modosito ut TETELES mezolistat ir, es ez nem volt kozte. Ez az allitas azt
   * a listat orzi: ha valaki kiveszi a sort, a kapcsolo tovabbra is LATSZIK a
   * feluleten, es a mentes is sikerul -- csak nem tortenik semmi.
   */
  it("carries the purchasable flag into the product row", async () => {
    const { database, calls } = createDatabase();
    const repository = new ProductRepository(database);
    await repository.update("product-1", { webshopSellable: true });

    const updateArgs = calls.find(
      (call) => call.operation === "transactionUpdate",
    )?.args as { data: { webshopSellable?: boolean } };
    assert.equal(updateArgs.data.webshopSellable, true);
  });

  /**
   * ES A HAMIS UGYANIGY ELJUT. Kulon allitas, mert egy `if (input.x)` alaku
   * iras a bekapcsolast atengedne, a KIkapcsolast pedig csendben elnyelne --
   * es akkor egy vasarolhato termeket nem lehetne visszavenni a webshopbol.
   */
  it("carries a cleared purchasable flag too, not just a set one", async () => {
    const { database, calls } = createDatabase();
    const repository = new ProductRepository(database);
    await repository.update("product-1", { webshopSellable: false });

    const updateArgs = calls.find(
      (call) => call.operation === "transactionUpdate",
    )?.args as { data: { webshopSellable?: boolean } };
    assert.equal(updateArgs.data.webshopSellable, false);
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
    assert.equal(result.items[0]?.origin, "UNAS");
    assert.equal(result.items[0]?.catalogAuthority, "UNAS");
    assert.equal(
      result.items[0]?.primaryCategory?.name,
      "Tengeri akvarisztika",
    );
    assert.equal(result.items[0]?.thumbnail?.sortOrder, 1);
    assert.equal(result.items[0]?.unasListing?.externalStatus, "3");
    assert.equal(result.items[0]?.grossPrice, "1270");
    assert.equal(result.items[0]?.saleGrossPrice, null);
    assert.equal(result.items[0]?.stockOnHand, "6");
  });

  /**
   * The webshop list asks for the products carried on the channel, and that
   * is what a listing row records. Publication is deliberately not part of
   * the test: nothing writes `isPublished`, so it is false on every row, and
   * a filter on it would answer with an empty shop. The screen shows the
   * channel's own status instead, which the sync does keep up to date.
   */
  it("narrows the list to the products listed on a channel, by listing and not by publication", async () => {
    const { database, calls } = createDatabase();
    const repository = new ProductRepository(database);

    await repository.list({ page: 1, pageSize: 20, listedOn: "UNAS" });

    const findArgs = calls.find((call) => call.operation === "findMany")
      ?.args as { where: Record<string, unknown> };
    assert.deepEqual(findArgs.where.channelListings, {
      some: { channel: "UNAS" },
    });
    assert.equal(
      JSON.stringify(findArgs.where).includes("isPublished"),
      false,
      "publication must not be part of the filter",
    );
  });

  it("leaves the list alone when no channel is asked for", async () => {
    const { database, calls } = createDatabase();
    const repository = new ProductRepository(database);

    await repository.list({ page: 1, pageSize: 20 });

    const findArgs = calls.find((call) => call.operation === "findMany")
      ?.args as { where: Record<string, unknown> };
    assert.equal(findArgs.where.channelListings, undefined);
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
    assert.equal(detail?.unasMirror?.externalId, "159850145");
    assert.equal(detail?.unasMirror?.grossPrice, "1270");
    assert.equal(detail?.unasMirror?.reportedStock, "7.5");
    assert.equal(detail?.variants[0]?.manufacturerPartNumber, "MPN-1");
    assert.equal(detail?.variants[0]?.extension?.minimumStock, "2");
  });

  it("soft archives instead of deleting", async () => {
    const { database, calls } = createDatabase();
    const repository = new ProductRepository(database);
    await repository.archive("product-1");

    const updateArgs = calls.find(
      (call) => call.operation === "transactionUpdate",
    )?.args as { data: { isActive: boolean; archivedAt: Date } };
    assert.equal(updateArgs.data.isActive, false);
    assert.ok(updateArgs.data.archivedAt instanceof Date);

    /**
     * AZ `isActive` A KERESHETOSEG EGYIK FELE, ezert a levetel ugyanabban a
     * tranzakcioban irja at a dokumentumot is. Enelkul az egyensuly-ellenorzes
     * ket szama MINDEN archivalas utan elterne, es az az ellenorzes, ami a
     * nema hibat keresi, maga valna zajossa.
     */
    assert.deepEqual(
      calls.map((call) => call.operation),
      ["transactionUpdate", "transactionFind", "searchDocumentUpsert"],
    );
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
