import type { ArKep } from "../imports/unas/unas-ar-tortenet.js";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";
import type {
  ProductDatabase,
  StoredProductImage,
  VariantPriceBefore,
} from "./product.repository.js";
import {
  ProductRepository,
  UPLOAD_TRANSACTION_TIMEOUT_MS,
  VariantSaleConflict,
} from "./product.repository.js";
import type { ProductWithRelations } from "./product.types.js";
import type {
  TakeoverPriceMirror,
  TakeoverPriceVariant,
} from "./takeover-price.js";

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
      sellingGrossPrice: new Prisma.Decimal("1524"),
      sellingPriceCurrency: "HUF",
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
      supplierProducts: [],
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
    vatRate: new Prisma.Decimal("27"),
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
const NO_SALE = {
  sellingSaleGrossPrice: null,
  sellingSaleStartsAt: null,
  sellingSaleEndsAt: null,
};

const SALE = {
  grossPrice: new Prisma.Decimal("7990"),
  startsAt: new Date("2026-11-10T00:00:00.000Z"),
  endsAt: new Date("2026-11-17T00:00:00.000Z"),
};

function createDatabase({
  authorityUpdateCount = 1,
  /** rows the conditional variant price copy touches (0: a price was typed in between) */
  variantCopyCount = 1,
  /** the variant's last own-price history row, if any */
  lastOwnPriceRow = null as ArKep | null,
  /** the variant before a price edit (null: not a variant of this product) */
  variantBefore = {
    sellingGrossPrice: new Prisma.Decimal("9990"),
    sellingPriceCurrency: "HUF",
    ...NO_SALE,
  } as VariantPriceBefore | null,
  /** the product's own images (id only), and how many rows an image write touches */
  ownImages = [{ id: "img-1" }, { id: "img-2" }, { id: "img-3" }],
  imageWriteCount = 1,
  /** the image a delete or a file read finds (null: not this product's image) */
  foundImage = {
    id: "img-2",
    url: "os-upload:abc",
    storageKey: "products/product-1/doc-2",
    fileName: "kek.jpg",
  } as StoredProductImage | null,
  /** the highest sortOrder before an upload (null: no image yet) */
  maxSortOrder = 4 as number | null,
  /** the product's shipping-flag sources (null: no profile row) */
  shippingSources = null as Record<string, "UNAS" | "MANUAL"> | null,
  mirror = {
    grossPrice: new Prisma.Decimal("12990"),
    currency: null,
  } as TakeoverPriceMirror,
  variants = [
    {
      id: "variant-1",
      sku: "RS-1",
      sellingGrossPrice: null,
      unasVariantExtraGrossPrice: null,
    },
  ] as TakeoverPriceVariant[],
} = {}) {
  const calls: Array<{ operation: string; args: unknown }> = [];
  const txOptions: unknown[] = [];
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
    unasProductSnapshot: {
      findUnique: async (args: unknown) => {
        calls.push({ operation: "mirrorFind", args });
        return mirror;
      },
    },
    productVariant: {
      findMany: async (args: unknown) => {
        calls.push({ operation: "variantFindMany", args });
        return variants;
      },
      findFirst: async (args: unknown) => {
        calls.push({ operation: "variantFindFirst", args });
        return variantBefore;
      },
      updateMany: async (args: unknown) => {
        calls.push({ operation: "variantUpdateMany", args });
        return { count: variantCopyCount };
      },
    },
    productImage: {
      findMany: async (args: unknown) => {
        calls.push({ operation: "imageFindMany", args });
        return ownImages;
      },
      findFirst: async (args: unknown) => {
        calls.push({ operation: "imageFindFirst", args });
        return foundImage;
      },
      aggregate: async (args: unknown) => {
        calls.push({ operation: "imageAggregate", args });
        return { _max: { sortOrder: maxSortOrder } };
      },
      create: async (args: unknown) => {
        calls.push({ operation: "imageCreate", args });
        return { id: "img-new" };
      },
      deleteMany: async (args: unknown) => {
        calls.push({ operation: "imageDeleteMany", args });
        return { count: 1 };
      },
      updateMany: async (args: unknown) => {
        calls.push({ operation: "imageUpdateMany", args });
        return { count: imageWriteCount };
      },
    },
    $queryRaw: async (query: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ operation: "lock", args: { sql: query.join("?"), values } });
      return [];
    },
    productShippingProfile: {
      findUnique: async (args: unknown) => {
        calls.push({ operation: "shippingFind", args });
        return shippingSources;
      },
      updateMany: async (args: unknown) => {
        calls.push({ operation: "shippingPin", args });
        return { count: 1 };
      },
    },
    productPriceHistory: {
      findFirst: async (args: unknown) => {
        calls.push({ operation: "historyFind", args });
        return lastOwnPriceRow;
      },
      create: async (args: unknown) => {
        calls.push({ operation: "historyCreate", args });
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
    productImage: {
      findFirst: async (args) => {
        calls.push({ operation: "imageRead", args });
        return foundImage;
      },
    },
    $transaction: (operation, options) => {
      txOptions.push(options);
      return operation(transaction);
    },
  };
  return { database, calls, txOptions };
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
      [
        "productUpdateMany",
        "mirrorFind",
        "variantFindMany",
        "variantUpdateMany",
        // the own price's history starts with the copy, inside the transaction (T4.1-D2)
        "historyFind",
        "historyCreate",
        // no profile row: nothing to pin (T4.1-D3)
        "shippingFind",
        "event",
        "transactionFind",
      ],
    );
    const updateArgs = calls[0]?.args as {
      where: { id: string; catalogAuthority: string };
      data: { catalogAuthority: string };
    };
    assert.equal(updateArgs.where.catalogAuthority, "UNAS");
    assert.equal(updateArgs.data.catalogAuthority, "ACROPORA");
    const eventArgs = calls[7]?.args as {
      data: { eventType: string; actorUserId: string; payload: unknown };
    };
    assert.equal(
      eventArgs.data.eventType,
      "product.catalog-authority.transferred",
    );
    assert.equal(eventArgs.data.actorUserId, "user-1");
    assert.deepEqual(eventArgs.data.payload, {
      from: "UNAS",
      to: "ACROPORA",
      priceSeed: {
        source: "unas-mirror-list-price",
        copied: [
          {
            variantId: "variant-1",
            sku: "RS-1",
            sellingGrossPrice: "12990.0000",
            sellingPriceCurrency: "HUF",
          },
        ],
        skipped: [],
      },
    });
  });

  /**
   * THE PRICE MOVES WITH THE AUTHORITY (card fc5fb5f9, Balázs's "b" of
   * 2026-09-04). Under ACROPORA authority the projection reads only the own
   * `sellingGrossPrice`, and nothing else ever writes it: without the copy
   * every taken-over product would stop at `own-price-missing` the same day.
   *
   * The copy is the LIST price plus the variant's UNAS surcharge, scoped to
   * this product, and conditional on the field still being empty at write
   * time, so a price typed in between is never overwritten.
   */
  it("copies the mirror list price with the surcharge into the empty own price", async () => {
    const { database, calls } = createDatabase({
      mirror: { grossPrice: new Prisma.Decimal("12990"), currency: null },
      variants: [
        {
          id: "variant-1",
          sku: "RS-1",
          sellingGrossPrice: null,
          unasVariantExtraGrossPrice: new Prisma.Decimal("1500"),
        },
      ],
    });
    const repository = new ProductRepository(database);

    await repository.takeCatalogAuthority("product-1", "user-1");

    const byOperation = (operation: string) =>
      calls.filter((call) => call.operation === operation);
    assert.deepEqual(byOperation("mirrorFind")[0]?.args, {
      where: { productId: "product-1" },
      select: { grossPrice: true, currency: true },
    });
    assert.deepEqual(
      (byOperation("variantFindMany")[0]?.args as { where: unknown }).where,
      { productId: "product-1" },
    );
    const writes = byOperation("variantUpdateMany");
    assert.equal(writes.length, 1);
    const write = writes[0]?.args as {
      where: { id: string; sellingGrossPrice: null };
      data: {
        sellingGrossPrice: Prisma.Decimal;
        sellingPriceCurrency: string;
      };
    };
    assert.deepEqual(write.where, { id: "variant-1", sellingGrossPrice: null });
    assert.equal(write.data.sellingGrossPrice.toFixed(4), "14490.0000");
    assert.equal(write.data.sellingPriceCurrency, "HUF");

    // THE HISTORY STARTS WITH THE COPY (T4.1-D2): one OWN row for the copied variant, written
    // after the copy and in the same transaction (the fake shares one call list)
    const history = byOperation("historyCreate");
    assert.equal(history.length, 1);
    const row = (
      history[0]?.args as {
        data: {
          productId: string;
          variantId: string;
          source: string;
          currency: string;
          grossPrice: Prisma.Decimal;
        };
      }
    ).data;
    assert.equal(row.productId, "product-1");
    assert.equal(row.variantId, "variant-1");
    assert.equal(row.source, "OWN");
    assert.equal(row.currency, "HUF");
    assert.equal(row.grossPrice.toFixed(4), "14490.0000");
    assert.ok(
      calls.findIndex((c) => c.operation === "variantUpdateMany") <
        calls.findIndex((c) => c.operation === "historyCreate"),
    );
  });

  // MI PIROSÍT: ha a másolás nem írt semmit (közben beírtak árat), mégis sor keletkezne az
  // előzményben: egy ár, amit nem mi másoltunk, nem a mi „első saját árunk".
  it("writes no history row for a variant whose price was typed in before the copy", async () => {
    const { database, calls } = createDatabase({ variantCopyCount: 0 });
    await new ProductRepository(database).takeCatalogAuthority(
      "product-1",
      "user-1",
    );
    assert.equal(
      calls.filter((c) => c.operation === "historyCreate").length,
      0,
    );
    assert.equal(calls.filter((c) => c.operation === "historyFind").length, 0);
  });

  /**
   * An own price already there is the owner's decision, not a gap: the
   * takeover leaves it alone and says so in the log. A variant the mirror
   * cannot price is skipped the same way, with its reason, and the others
   * still get theirs.
   */
  it("keeps an own price and logs every variant it did not price", async () => {
    const { database, calls } = createDatabase({
      mirror: { grossPrice: null, currency: null },
      variants: [
        {
          id: "variant-1",
          sku: "RS-1",
          sellingGrossPrice: new Prisma.Decimal("9990"),
          unasVariantExtraGrossPrice: null,
        },
        {
          id: "variant-2",
          sku: "RS-2",
          sellingGrossPrice: null,
          unasVariantExtraGrossPrice: null,
        },
      ],
    });
    const repository = new ProductRepository(database);

    await repository.takeCatalogAuthority("product-1", "user-1");

    assert.equal(
      calls.filter((call) => call.operation === "variantUpdateMany").length,
      0,
    );
    const event = calls.find((call) => call.operation === "event")?.args as {
      data: { payload: { priceSeed: unknown } };
    };
    assert.deepEqual(event.data.payload.priceSeed, {
      source: "unas-mirror-list-price",
      copied: [],
      skipped: [
        { variantId: "variant-1", sku: "RS-1", reason: "own-price-set" },
        { variantId: "variant-2", sku: "RS-2", reason: "mirror-price-missing" },
      ],
    });
  });

  /**
   * The other half, and the one a single test would miss: repeating the
   * transfer is not an error - the product is ours either way - but it must
   * not write a second event. A log that reports one decision twice is worse
   * than no log, because it invents a history nobody lived.
   */
  /**
   * THE OWN-PRICE EDITOR (T4.1-D3, slice 2). One transaction: the price only on
   * a variant of THIS product, the history row through `recordOwnPrice`, the
   * product's `updatedAt` stepped (the Medusa projection's due query reads the
   * product row's time), and an event with the old and the new price.
   */
  it("sets a variant's own price with its history, and makes the product due", async () => {
    const { database, calls } = createDatabase();
    const result = await new ProductRepository(database).setVariantSellingPrice(
      "product-1",
      "variant-1",
      new Prisma.Decimal("12990"),
      "user-1",
    );

    assert.ok(result);
    assert.deepEqual(
      calls.map((call) => call.operation),
      [
        "variantFindFirst",
        "variantUpdateMany",
        "historyFind",
        "historyCreate",
        "transactionUpdate",
        "event",
        "transactionFind",
      ],
    );
    const write = calls[1]?.args as {
      where: { id: string; productId: string };
      data: { sellingGrossPrice: Prisma.Decimal; sellingPriceCurrency: string };
    };
    assert.deepEqual(write.where, { id: "variant-1", productId: "product-1" });
    assert.equal(write.data.sellingGrossPrice.toString(), "12990");
    assert.equal(write.data.sellingPriceCurrency, "HUF");
    const touch = calls[4]?.args as {
      where: { id: string };
      data: { updatedAt: Date };
    };
    assert.equal(touch.where.id, "product-1");
    assert.ok(touch.data.updatedAt instanceof Date);
    const event = calls[5]?.args as {
      data: { eventType: string; actorUserId: string; payload: unknown };
    };
    assert.equal(event.data.eventType, "product.variant.selling-price.set");
    assert.equal(event.data.actorUserId, "user-1");
    assert.deepEqual(event.data.payload, {
      variantId: "variant-1",
      from: "9990",
      to: "12990",
      currency: "HUF",
      history: "written",
    });
  });

  /**
   * TWO SIMULTANEOUS SAVES (barracuda, #2130): Serializable aborts one of them with
   * P2034. The editor retries the whole transaction instead of answering 500, and the
   * retry reads the fresher before-image.
   */
  it("retries the price transaction once Postgres reports a serialization conflict", async () => {
    const { database, calls } = createDatabase();
    let attempts = 0;
    const flaky: ProductDatabase = {
      ...database,
      $transaction: (operation, options) => {
        attempts += 1;
        if (attempts === 1)
          return Promise.reject(
            Object.assign(new Error("serialization failure"), {
              code: "P2034",
            }),
          );
        return database.$transaction(operation, options);
      },
    };

    const result = await new ProductRepository(flaky).setVariantSellingPrice(
      "product-1",
      "variant-1",
      new Prisma.Decimal("12990"),
    );

    assert.ok(result);
    assert.equal(attempts, 2);
    assert.equal(
      calls.filter((call) => call.operation === "variantUpdateMany").length,
      1,
    );
  });

  it("writes nothing for a variant id that is not this product's", async () => {
    const { database, calls } = createDatabase({ variantBefore: null });
    const result = await new ProductRepository(database).setVariantSellingPrice(
      "product-1",
      "variant-x",
      new Prisma.Decimal("12990"),
    );

    assert.equal(result, null);
    assert.deepEqual(
      calls.map((call) => call.operation),
      ["variantFindFirst"],
    );
  });

  /**
   * THE OWN SALE (T4.1-D3, sale slice 1): only below the own price, only on a
   * variant of this product; a clear writes three nulls; the regular price cannot
   * drop to the sale. MI PIROSÍT: ha egy nem olcsóbb akció vagy egy akció alá
   * csökkenő rendes ár átmegy; ha az akció a történetbe íródik (ez a szelet még
   * nem vetít).
   */
  it("sets a sale below the own price, makes the product due, and writes no history yet", async () => {
    const { database, calls } = createDatabase();
    const result = await new ProductRepository(database).setVariantSale(
      "product-1",
      "variant-1",
      SALE,
      "user-1",
    );
    assert.ok(result);
    assert.deepEqual(
      calls.map((call) => call.operation),
      [
        "variantFindFirst",
        "variantUpdateMany",
        "transactionUpdate",
        "event",
        "transactionFind",
      ],
    );
    const write = calls[1]?.args as {
      where: unknown;
      data: Record<string, unknown>;
    };
    assert.deepEqual(write.where, { id: "variant-1", productId: "product-1" });
    assert.deepEqual(write.data, {
      sellingSaleGrossPrice: SALE.grossPrice,
      sellingSaleStartsAt: SALE.startsAt,
      sellingSaleEndsAt: SALE.endsAt,
    });
    const event = calls[3]?.args as {
      data: { eventType: string; payload: unknown };
    };
    assert.equal(event.data.eventType, "product.variant.sale.set");
    assert.deepEqual(event.data.payload, {
      variantId: "variant-1",
      from: null,
      to: {
        grossPrice: "7990",
        startsAt: "2026-11-10T00:00:00.000Z",
        endsAt: "2026-11-17T00:00:00.000Z",
      },
    });
  });

  it("refuses a sale that is not below the own price, or with no own price", async () => {
    for (const [grossPrice, code] of [
      ["9990", "sale-not-lower"],
      ["12000", "sale-not-lower"],
    ] as const) {
      const { database, calls } = createDatabase();
      await assert.rejects(
        () =>
          new ProductRepository(database).setVariantSale(
            "product-1",
            "variant-1",
            { ...SALE, grossPrice: new Prisma.Decimal(grossPrice) },
          ),
        (error: unknown) =>
          error instanceof VariantSaleConflict && error.code === code,
      );
      assert.deepEqual(
        calls.map((call) => call.operation),
        ["variantFindFirst"],
        grossPrice,
      );
    }
    const unpriced = createDatabase({
      variantBefore: {
        sellingGrossPrice: null,
        sellingPriceCurrency: null,
        ...NO_SALE,
      },
    });
    await assert.rejects(
      () =>
        new ProductRepository(unpriced.database).setVariantSale(
          "product-1",
          "variant-1",
          SALE,
        ),
      (error: unknown) =>
        error instanceof VariantSaleConflict &&
        error.code === "own-price-missing",
    );
  });

  it("clears a sale to three nulls, and names the old one in the event", async () => {
    const { database, calls } = createDatabase({
      variantBefore: {
        sellingGrossPrice: new Prisma.Decimal("9990"),
        sellingPriceCurrency: "HUF",
        sellingSaleGrossPrice: SALE.grossPrice,
        sellingSaleStartsAt: SALE.startsAt,
        sellingSaleEndsAt: SALE.endsAt,
      },
    });
    await new ProductRepository(database).setVariantSale(
      "product-1",
      "variant-1",
      null,
    );
    const write = calls.find((call) => call.operation === "variantUpdateMany")
      ?.args as { data: Record<string, unknown> };
    assert.deepEqual(write.data, {
      sellingSaleGrossPrice: null,
      sellingSaleStartsAt: null,
      sellingSaleEndsAt: null,
    });
    const event = calls.find((call) => call.operation === "event")?.args as {
      data: { eventType: string; payload: { from: unknown; to: unknown } };
    };
    assert.equal(event.data.eventType, "product.variant.sale.cleared");
    assert.deepEqual(event.data.payload.from, {
      grossPrice: "7990",
      startsAt: "2026-11-10T00:00:00.000Z",
      endsAt: "2026-11-17T00:00:00.000Z",
    });
    assert.equal(event.data.payload.to, null);
  });

  it("writes no sale on a variant of another product", async () => {
    const { database, calls } = createDatabase({ variantBefore: null });
    assert.equal(
      await new ProductRepository(database).setVariantSale(
        "product-1",
        "variant-x",
        SALE,
      ),
      null,
    );
    assert.deepEqual(
      calls.map((call) => call.operation),
      ["variantFindFirst"],
    );
  });

  it("refuses a regular price at or below a running or a future sale, and lets it under an expired one (barracuda, #2147)", async () => {
    const most = new Date("2026-11-12T00:00:00.000Z");
    const windows = {
      running: { startsAt: SALE.startsAt, endsAt: SALE.endsAt },
      future: {
        startsAt: new Date("2026-11-20T00:00:00.000Z"),
        endsAt: new Date("2026-11-27T00:00:00.000Z"),
      },
      expired: {
        startsAt: new Date("2026-10-01T00:00:00.000Z"),
        endsAt: new Date("2026-10-08T00:00:00.000Z"),
      },
    };
    for (const [name, window] of Object.entries(windows))
      for (const price of ["7990", "7000"]) {
        const { database, calls } = createDatabase({
          variantBefore: {
            sellingGrossPrice: new Prisma.Decimal("9990"),
            sellingPriceCurrency: "HUF",
            sellingSaleGrossPrice: SALE.grossPrice,
            sellingSaleStartsAt: window.startsAt,
            sellingSaleEndsAt: window.endsAt,
          },
        });
        const save = () =>
          new ProductRepository(database).setVariantSellingPrice(
            "product-1",
            "variant-1",
            new Prisma.Decimal(price),
            undefined,
            most,
          );
        if (name === "expired") {
          assert.ok(await save(), `${name} ${price}`);
          assert.ok(
            calls.some((call) => call.operation === "variantUpdateMany"),
            `${name} ${price}`,
          );
        } else {
          await assert.rejects(
            save,
            (error: unknown) =>
              error instanceof VariantSaleConflict &&
              error.code === "sale-not-lower",
            `${name} ${price}`,
          );
          assert.deepEqual(
            calls.map((call) => call.operation),
            ["variantFindFirst"],
            `${name} ${price}`,
          );
        }
      }
  });

  it("starts a first own price in forint and still writes no duplicate history", async () => {
    const { database, calls } = createDatabase({
      variantBefore: {
        sellingGrossPrice: null,
        sellingPriceCurrency: null,
        ...NO_SALE,
      },
      lastOwnPriceRow: {
        currency: "HUF",
        netPrice: null,
        grossPrice: new Prisma.Decimal("12990"),
        saleNetPrice: null,
        saleGrossPrice: null,
      } as ArKep,
    });
    await new ProductRepository(database).setVariantSellingPrice(
      "product-1",
      "variant-1",
      new Prisma.Decimal("12990"),
    );

    const write = calls.find((call) => call.operation === "variantUpdateMany")
      ?.args as { data: { sellingPriceCurrency: string } };
    assert.equal(write.data.sellingPriceCurrency, "HUF");
    assert.equal(
      calls.some((call) => call.operation === "historyCreate"),
      false,
    );
    const event = calls.find((call) => call.operation === "event")?.args as {
      data: { payload: { from: string | null; history: string } };
    };
    assert.equal(event.data.payload.from, null);
    assert.equal(event.data.payload.history, "unchanged");
  });

  /**
   * THE UNAS-FOLLOWING SHIPPING FLAGS BECOME MANUAL (T4.1-D3, card af14c36e).
   * After the takeover the sync skips the product, so a flag whose source says
   * UNAS would never be refreshed again while still claiming to follow UNAS.
   * Only the UNAS-sourced flags move, the value is not written, and the event
   * names which flags moved.
   */
  it("turns the UNAS-sourced shipping flags manual, and names them in the event", async () => {
    const { database, calls } = createDatabase({
      shippingSources: {
        pickupOnlySource: "UNAS",
        foxpostForbiddenSource: "MANUAL",
        isHeavySource: "UNAS",
        isFrozenSource: "MANUAL",
      },
    });

    await new ProductRepository(database).takeCatalogAuthority(
      "product-1",
      "user-1",
    );

    const pin = calls.find((call) => call.operation === "shippingPin");
    assert.deepEqual(pin?.args, {
      where: { productId: "product-1" },
      data: { pickupOnlySource: "MANUAL", isHeavySource: "MANUAL" },
    });
    const event = calls.find((call) => call.operation === "event")?.args as {
      data: { payload: { shippingFlagsPinned?: string[] } };
    };
    assert.deepEqual(event.data.payload.shippingFlagsPinned, [
      "pickupOnly",
      "isHeavy",
    ]);
  });

  it("writes no shipping row when every flag is already manual", async () => {
    const { database, calls } = createDatabase({
      shippingSources: {
        pickupOnlySource: "MANUAL",
        foxpostForbiddenSource: "MANUAL",
        isHeavySource: "MANUAL",
        isFrozenSource: "MANUAL",
      },
    });

    await new ProductRepository(database).takeCatalogAuthority(
      "product-1",
      "user-1",
    );

    assert.equal(
      calls.some((call) => call.operation === "shippingPin"),
      false,
    );
    const event = calls.find((call) => call.operation === "event")?.args as {
      data: { payload: Record<string, unknown> };
    };
    assert.equal("shippingFlagsPinned" in event.data.payload, false);
  });

  /**
   * THE IMAGE EDITOR (T4.1-D3, slice 4): an alt text only on this product's image, the
   * order only as an exact permutation of the product's images; both step the
   * product's `updatedAt` (the projection's due query) and write an event.
   */
  it("sets an image's alt text on this product's image, and makes the product due", async () => {
    const { database, calls } = createDatabase();
    const result = await new ProductRepository(database).setImageAltText(
      "product-1",
      "img-2",
      "Kék Acropora, felülnézet",
      "user-1",
    );
    assert.ok(result);
    assert.deepEqual(
      calls.map((call) => call.operation),
      ["imageUpdateMany", "transactionUpdate", "event", "transactionFind"],
    );
    assert.deepEqual(calls[0]?.args, {
      where: { id: "img-2", productId: "product-1" },
      data: { altText: "Kék Acropora, felülnézet" },
    });
    const event = calls[2]?.args as {
      data: { eventType: string; actorUserId: string; payload: unknown };
    };
    assert.equal(event.data.eventType, "product.image.alt-text.set");
    assert.deepEqual(event.data.payload, {
      imageId: "img-2",
      altText: "Kék Acropora, felülnézet",
    });
  });

  it("writes nothing else for an image of another product", async () => {
    const { database, calls } = createDatabase({ imageWriteCount: 0 });
    const result = await new ProductRepository(database).setImageAltText(
      "product-1",
      "img-x",
      null,
    );
    assert.equal(result, null);
    assert.deepEqual(
      calls.map((call) => call.operation),
      ["imageUpdateMany"],
    );
  });

  it("orders the images by the given permutation", async () => {
    const { database, calls } = createDatabase();
    const result = await new ProductRepository(database).setImageOrder(
      "product-1",
      ["img-3", "img-1", "img-2"],
      "user-1",
    );
    assert.ok(result);
    assert.deepEqual(
      calls
        .filter((call) => call.operation === "imageUpdateMany")
        .map((call) => call.args),
      [
        {
          where: { id: "img-3", productId: "product-1" },
          data: { sortOrder: 0 },
        },
        {
          where: { id: "img-1", productId: "product-1" },
          data: { sortOrder: 1 },
        },
        {
          where: { id: "img-2", productId: "product-1" },
          data: { sortOrder: 2 },
        },
      ],
    );
    assert.ok(calls.some((call) => call.operation === "transactionUpdate"));
  });

  it("locks the product row before it reads the images it orders (barracuda, #2139)", async () => {
    const { database, calls } = createDatabase();
    await new ProductRepository(database).setImageOrder("product-1", [
      "img-1",
      "img-2",
      "img-3",
    ]);
    assert.deepEqual(calls[0], {
      operation: "lock",
      args: {
        sql: 'SELECT "id" FROM "Product" WHERE "id" = ? FOR UPDATE',
        values: ["product-1"],
      },
    });
  });

  /**
   * UPLOAD AND DELETE (T4.1-D3, slice 6): both under the product row's lock, an
   * upload at the end of the list as an OS-sourced row, a delete only of this
   * product's image, and both make the product due with an event.
   */
  it("adds an uploaded image at the end of the list, under the product lock", async () => {
    const { database, calls } = createDatabase();
    const result = await new ProductRepository(database).addUploadedImage(
      "product-1",
      {
        url: "os-upload:abc",
        storageKey: "products/product-1/doc-1",
        fileName: "kek.jpg",
      },
      async () => {
        calls.push({ operation: "storeFile", args: null });
      },
      "user-1",
    );
    assert.ok(result);
    assert.deepEqual(
      calls.map((call) => call.operation),
      [
        "lock",
        "storeFile",
        "imageAggregate",
        "imageCreate",
        "transactionUpdate",
        "event",
        "transactionFind",
      ],
    );
    assert.deepEqual(
      calls.find((call) => call.operation === "imageCreate")?.args,
      {
        data: {
          productId: "product-1",
          url: "os-upload:abc",
          storageKey: "products/product-1/doc-1",
          fileName: "kek.jpg",
          sortOrder: 5,
          source: "OS",
        },
        select: { id: true },
      },
    );
    const event = calls.find((call) => call.operation === "event")?.args as {
      data: { eventType: string; payload: unknown };
    };
    assert.equal(event.data.eventType, "product.image.uploaded");
    assert.deepEqual(event.data.payload, {
      imageId: "img-new",
      fileName: "kek.jpg",
    });
  });

  it("gives the upload transaction a timeout above Prisma's 5 s default (barracuda, #2145)", async () => {
    const { database, txOptions } = createDatabase();
    await new ProductRepository(database).addUploadedImage(
      "product-1",
      {
        url: "os-upload:abc",
        storageKey: "products/product-1/doc-1",
        fileName: "kek.jpg",
      },
      async () => {},
    );
    assert.deepEqual(txOptions, [{ timeout: UPLOAD_TRANSACTION_TIMEOUT_MS }]);
    assert.ok(UPLOAD_TRANSACTION_TIMEOUT_MS > 5_000);
  });

  it("gives the first uploaded image sortOrder 0", async () => {
    const { database, calls } = createDatabase({ maxSortOrder: null });
    await new ProductRepository(database).addUploadedImage(
      "product-1",
      {
        url: "os-upload:abc",
        storageKey: "products/product-1/doc-1",
        fileName: "kek.jpg",
      },
      async () => {},
    );
    const create = calls.find((call) => call.operation === "imageCreate")
      ?.args as { data: { sortOrder: number } };
    assert.equal(create.data.sortOrder, 0);
  });

  it("removes this product's image and returns the removed row", async () => {
    const { database, calls } = createDatabase();
    const result = await new ProductRepository(database).removeImage(
      "product-1",
      "img-2",
      "user-1",
    );
    assert.equal(result?.removed.url, "os-upload:abc");
    assert.deepEqual(
      calls.map((call) => call.operation),
      [
        "lock",
        "imageFindFirst",
        "imageDeleteMany",
        "transactionUpdate",
        "event",
        "transactionFind",
      ],
    );
    assert.deepEqual(
      calls.find((call) => call.operation === "imageDeleteMany")?.args,
      { where: { id: "img-2", productId: "product-1" } },
    );
  });

  it("removes nothing for an image of another product", async () => {
    const { database, calls } = createDatabase({ foundImage: null });
    const result = await new ProductRepository(database).removeImage(
      "product-1",
      "img-x",
    );
    assert.equal(result, null);
    assert.deepEqual(
      calls.map((call) => call.operation),
      ["lock", "imageFindFirst"],
    );
  });

  it("releases an image file only under the lock, and only with no row left (barracuda, #2142)", async () => {
    const free = createDatabase({ foundImage: null });
    let released = 0;
    assert.equal(
      await new ProductRepository(free.database).releaseImageFileIfUnused(
        "product-1",
        "os-upload:abc",
        async () => {
          free.calls.push({ operation: "releaseFile", args: null });
          released += 1;
        },
      ),
      true,
    );
    assert.deepEqual(
      free.calls.map((call) => call.operation),
      ["lock", "imageFindFirst", "releaseFile"],
    );
    assert.deepEqual((free.calls[1]?.args as { where: unknown }).where, {
      productId: "product-1",
      url: "os-upload:abc",
    });

    // egy közben újra feltöltött sor a fájlt megtartja
    const used = createDatabase();
    assert.equal(
      await new ProductRepository(used.database).releaseImageFileIfUnused(
        "product-1",
        "os-upload:abc",
        async () => {
          released += 1;
        },
      ),
      false,
    );
    assert.equal(released, 1);
  });

  it("reads an image row only within the product", async () => {
    const { database, calls } = createDatabase();
    await new ProductRepository(database).findImage("product-1", "img-2");
    assert.deepEqual(
      (
        calls.find((call) => call.operation === "imageRead")?.args as {
          where: unknown;
        }
      ).where,
      { id: "img-2", productId: "product-1" },
    );
  });

  it("writes no order unless every own image is there exactly once", async () => {
    for (const ids of [
      ["img-1", "img-2"],
      ["img-1", "img-2", "img-2"],
      ["img-1", "img-2", "img-x"],
      ["img-1", "img-2", "img-3", "img-x"],
    ]) {
      const { database, calls } = createDatabase();
      const result = await new ProductRepository(database).setImageOrder(
        "product-1",
        ids,
      );
      assert.equal(result, null, ids.join(","));
      assert.deepEqual(
        calls.map((call) => call.operation),
        ["lock", "imageFindMany"],
        ids.join(","),
      );
    }
  });

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

  /**
   * A switch back to UNAS is not this method, and a repeated takeover is not
   * a takeover: neither may touch a price. The copy runs only on the call
   * that actually moved the authority.
   */
  it("prices nothing when the product was already ours", async () => {
    const { database, calls } = createDatabase({ authorityUpdateCount: 0 });
    const repository = new ProductRepository(database);

    await repository.takeCatalogAuthority("product-1", "user-1");

    assert.deepEqual(
      calls
        .map((call) => call.operation)
        .filter((operation) =>
          ["mirrorFind", "variantFindMany", "variantUpdateMany"].includes(
            operation,
          ),
        ),
      [],
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

  it("writes placement needs only through the local datasheet upsert", async () => {
    const { database, calls } = createDatabase();
    const repository = new ProductRepository(database);
    await repository.update("product-1", {
      fenyIgeny: "EROS",
      aramlasIgeny: "KOZEPES",
    });

    const updateArgs = calls.find(
      (call) => call.operation === "transactionUpdate",
    )?.args as {
      data: {
        datasheet?: {
          upsert?: {
            create?: { fenyIgeny?: string; aramlasIgeny?: string };
            update?: { fenyIgeny?: string; aramlasIgeny?: string };
          };
        };
      };
    };
    assert.deepEqual(updateArgs.data.datasheet?.upsert?.create, {
      fenyIgeny: "EROS",
      aramlasIgeny: "KOZEPES",
    });
    assert.deepEqual(updateArgs.data.datasheet?.upsert?.update, {
      fenyIgeny: "EROS",
      aramlasIgeny: "KOZEPES",
    });
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
    // THE BILLING EDITOR READS THESE TWO to pre-fill a line (2026-09-30): our
    // own gross price on the variant, and the shop's VAT rate on the mirror.
    assert.equal(detail?.variants[0]?.sellingGrossPrice, "1524");
    assert.equal(detail?.variants[0]?.sellingPriceCurrency, "HUF");
    assert.equal(detail?.unasMirror?.vatRate, "27");
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
