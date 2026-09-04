import { createHash } from "node:crypto";

import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, Repository, prisma } from "@acropora/database";
import type {
  CanonicalUnasProduct,
  UnasApiCategory,
  UnasApiProduct,
  UnasApiStock,
  UnasProductIdentitySnapshot,
  UnasProductSyncDiff,
  UnasProductSyncSummary,
} from "@acropora/types";

import {
  unasVariantKey,
  unasVariantLabel,
  unasVariantSku,
} from "../../common/unas-variant.util.js";
import { writeSearchDocument } from "../../integrations/ai-product-search/ai-product-search.writer.js";
import {
  describeSkipped,
  partitionByUnasAuthority,
  type SkippedProduct,
} from "./unas-write-policy.js";

const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const eventId = (...parts: string[]) =>
  createHash("sha256").update(parts.join("|")).digest("hex");
const categorySlug = (category: UnasApiCategory) =>
  `unas-${category.externalId}-${
    category.name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "category"
  }`;
const absoluteHttpUrl = (candidate: string | null) => {
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
};
const snapshotData = (product: CanonicalUnasProduct, syncedAt: Date) => ({
  netPrice: product.netPrice,
  grossPrice: product.grossPrice,
  saleNetPrice: product.saleNetPrice,
  saleGrossPrice: product.saleGrossPrice,
  saleStartsAt: product.saleStartsAt ? new Date(product.saleStartsAt) : null,
  saleEndsAt: product.saleEndsAt ? new Date(product.saleEndsAt) : null,
  priceDisplay: product.priceDisplay,
  descriptionShort: product.descriptionShort,
  descriptionLong: product.descriptionLong,
  descriptionShortIsHtml: product.descriptionShortIsHtml,
  descriptionLongIsHtml: product.descriptionLongIsHtml,
  productUrl: product.productUrl,
  sefUrl: product.sefUrl,
  manufacturerUrl: product.manufacturerUrl,
  vatRate: product.vatRate,
  minimumOrderQuantity: product.minimumOrderQuantity,
  maximumOrderQuantity: product.maximumOrderQuantity,
  orderQuantityStep: product.orderQuantityStep,
  backorderAllowed: product.backorderAllowed,
  variantStockEnabled:
    product.variantStockEnabled === true || product.variantStocks.length > 0,
  lowStockThreshold: product.lowStockThreshold,
  reportedStock: product.reportedStock,
  reportedStockSyncedAt:
    product.variantStocks.length > 0
      ? null
      : product.reportedStock !== null
        ? syncedAt
        : undefined,
  isPackageProduct: product.isPackageProduct,
  packageComponents: json(product.packageComponents),
  primaryCategoryExternalId: product.primaryCategoryExternalId,
  alternativeCategoryExternalIds: json(product.alternativeCategoryExternalIds),
  images: json(product.images),
  parameters: json(product.parameters),
  seo: json(product.seo),
  rawPayload: json(product.rawPayload),
});
const ACTIVE_SYNC_KEY = "UNAS_PRODUCTS";
const STALE_RUN_AFTER_MS = 15 * 60_000;

/// OS-side import rule only: it never writes to UNAS or Medusa.
export function webshopSellableFromUnas(
  product: Pick<UnasApiProduct, "externalStatus" | "inquireOnly">,
): boolean {
  const isListedInWebshop = product.externalStatus === "1";
  const isInquiryOnly = product.inquireOnly === true;
  return isListedInWebshop && !isInquiryOnly;
}

async function closeRetiredVariantOutbox(
  transaction: Prisma.TransactionClient,
  variantIds: string[],
  syncedAt: Date,
) {
  if (variantIds.length === 0) return;
  await transaction.unasStockSyncOutbox.updateMany({
    where: {
      variantId: { in: variantIds },
      status: { in: ["PENDING", "PROCESSING", "FAILED", "DEAD_LETTER"] },
    },
    data: {
      status: "SUCCEEDED",
      lastError: null,
      leaseExpiresAt: null,
      resolutionNote: "unas_variant_mapping_retired:product_sync",
      processedAt: syncedAt,
    },
  });
}

async function syncProductVariants(
  transaction: Prisma.TransactionClient,
  productId: string,
  source: CanonicalUnasProduct,
  syncedAt: Date,
) {
  const hasVariantStock =
    source.variantStockEnabled === true || source.variantStocks.length > 0;
  if (hasVariantStock && source.variantStocks.length === 0)
    throw new Error(`UNAS_VARIANT_STOCK_ROWS_MISSING:${source.sku}`);

  const expected = hasVariantStock
    ? source.variantStocks.map((stock) => {
        const key = unasVariantKey(stock.values);
        if (!key) throw new Error(`UNAS_VARIANT_VALUES_MISSING:${source.sku}`);
        return {
          key,
          sku: unasVariantSku(source.sku, key),
          name: `${source.name} — ${unasVariantLabel(stock.values)}`,
          values: stock.values,
          reportedStock: stock.reportedStock,
        };
      })
    : [
        {
          key: null,
          sku: source.sku,
          name: source.name,
          values: null,
          reportedStock: source.reportedStock,
        },
      ];
  const keys = expected.flatMap((item) => (item.key ? [item.key] : []));
  if (new Set(keys).size !== keys.length)
    throw new Error(`DUPLICATE_UNAS_VARIANT_COMBINATION:${source.sku}`);

  const existing = await transaction.productVariant.findMany({
    where: { productId },
    select: { id: true, sku: true, unasVariantKey: true, isActive: true },
  });

  if (!hasVariantStock) {
    const mapped = existing.filter((item) => item.unasVariantKey === null);
    if (mapped.length > 1)
      throw new Error(`UNAS_MIRROR_VARIANT_CARDINALITY:${source.sku}`);
    const target = mapped[0];
    if (target) {
      await transaction.productVariant.update({
        where: { id: target.id },
        data: {
          sku: source.sku,
          name: source.name,
          unit: source.unit ?? "db",
          vatRate: source.vatRate,
          manufacturerPartNumber: source.manufacturerPartNumber,
          secondaryUnit: source.secondaryUnit,
          secondaryUnitFactor: source.secondaryUnitFactor,
          isActive: true,
          unasBaseSku: source.sku,
          unasVariantValues: Prisma.DbNull,
          unasReportedStock: source.reportedStock,
          unasReportedStockSyncedAt:
            source.reportedStock === null ? null : syncedAt,
        },
      });
    } else {
      await transaction.productVariant.create({
        data: {
          productId,
          sku: source.sku,
          name: source.name,
          unit: source.unit ?? "db",
          vatRate: source.vatRate,
          manufacturerPartNumber: source.manufacturerPartNumber,
          secondaryUnit: source.secondaryUnit,
          secondaryUnitFactor: source.secondaryUnitFactor,
          unasBaseSku: source.sku,
          unasReportedStock: source.reportedStock,
          unasReportedStockSyncedAt:
            source.reportedStock === null ? null : syncedAt,
        },
      });
    }
    const retired = existing.filter(
      (item) => item.unasVariantKey !== null && item.isActive,
    );
    if (retired.length > 0) {
      await transaction.productVariant.updateMany({
        where: { id: { in: retired.map((item) => item.id) } },
        data: { isActive: false },
      });
      await closeRetiredVariantOutbox(
        transaction,
        retired.map((item) => item.id),
        syncedAt,
      );
    }
    return;
  }

  // The old single aggregate variant is kept as inactive history instead
  // of being assigned to an arbitrary first UNAS combination.
  const legacy = existing.filter((item) => item.unasVariantKey === null);
  if (legacy.length > 0) {
    await transaction.productVariant.updateMany({
      where: { id: { in: legacy.map((item) => item.id) } },
      data: { isActive: false, unasBaseSku: source.sku },
    });
    await closeRetiredVariantOutbox(
      transaction,
      legacy.map((item) => item.id),
      syncedAt,
    );
  }

  const activeKeys = new Set(keys);
  const retired = existing.filter(
    (item) => item.unasVariantKey && !activeKeys.has(item.unasVariantKey),
  );
  if (retired.length > 0) {
    await transaction.productVariant.updateMany({
      where: { id: { in: retired.map((item) => item.id) } },
      data: { isActive: false },
    });
    await closeRetiredVariantOutbox(
      transaction,
      retired.map((item) => item.id),
      syncedAt,
    );
  }

  for (const item of expected) {
    const mapped = existing.find(
      (candidate) => candidate.unasVariantKey === item.key,
    );
    const data = {
      sku: item.sku,
      name: item.name,
      unit: source.unit ?? "db",
      vatRate: source.vatRate,
      manufacturerPartNumber: source.manufacturerPartNumber,
      secondaryUnit: source.secondaryUnit,
      secondaryUnitFactor: source.secondaryUnitFactor,
      isActive: true,
      unasBaseSku: source.sku,
      unasVariantKey: item.key,
      unasVariantValues: json(item.values),
      unasReportedStock: item.reportedStock,
      unasReportedStockSyncedAt: syncedAt,
    };
    if (mapped)
      await transaction.productVariant.update({
        where: { id: mapped.id },
        data,
      });
    else
      await transaction.productVariant.create({
        data: { productId, ...data },
      });
  }
}

@Injectable()
export class UnasProductSyncRepository extends Repository {
  constructor() {
    super(prisma);
  }

  async getCursor(): Promise<Date | null> {
    const cursor = await prisma.integrationCursor.findUnique({
      where: { provider_stream: { provider: "UNAS", stream: "PRODUCTS" } },
    });
    return cursor?.lastSuccessfulWindowEnd ?? null;
  }

  async getStockCursor(): Promise<Date | null> {
    const cursor = await prisma.integrationCursor.findUnique({
      where: { provider_stream: { provider: "UNAS", stream: "STOCKS" } },
    });
    return cursor?.lastSuccessfulWindowEnd ?? null;
  }

  async createRun(input: {
    kind: "FULL" | "INCREMENTAL";
    windowStart: Date | null;
    windowEnd: Date;
  }): Promise<string> {
    try {
      const run = await prisma.$transaction(async (transaction) => {
        await transaction.unasProductSyncRun.updateMany({
          where: {
            activeKey: ACTIVE_SYNC_KEY,
            status: "RUNNING",
            updatedAt: { lt: new Date(Date.now() - STALE_RUN_AFTER_MS) },
          },
          data: {
            activeKey: null,
            status: "FAILED",
            completedAt: new Date(),
            errorCode: "UNAS_PRODUCT_SYNC_STALE",
          },
        });
        return transaction.unasProductSyncRun.create({
          data: {
            ...input,
            activeKey: ACTIVE_SYNC_KEY,
            status: "RUNNING",
            startedAt: new Date(),
          },
        });
      });
      return run.id;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw new ConflictException("UNAS_PRODUCT_SYNC_ALREADY_RUNNING");
      throw error;
    }
  }

  async heartbeat(runId: string): Promise<void> {
    const result = await prisma.unasProductSyncRun.updateMany({
      where: { id: runId, activeKey: ACTIVE_SYNC_KEY, status: "RUNNING" },
      data: { updatedAt: new Date() },
    });
    if (!result.count) throw new Error("UNAS_PRODUCT_SYNC_RUN_NOT_ACTIVE");
  }

  async getRun(runId: string) {
    const run = await prisma.unasProductSyncRun.findUnique({
      where: { id: runId },
      select: {
        id: true,
        kind: true,
        status: true,
        windowStart: true,
        windowEnd: true,
        startedAt: true,
        completedAt: true,
        productsSeen: true,
        createdCount: true,
        updatedCount: true,
        unchangedCount: true,
        conflictCount: true,
        missingCount: true,
        skippedCount: true,
        skippedSourceChangedCount: true,
        errorCode: true,
      },
    });
    if (!run) throw new NotFoundException("UNAS_PRODUCT_SYNC_RUN_NOT_FOUND");
    return run;
  }

  listRuns(limit: number) {
    return prisma.unasProductSyncRun.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
      select: {
        id: true,
        kind: true,
        status: true,
        windowStart: true,
        windowEnd: true,
        startedAt: true,
        completedAt: true,
        productsSeen: true,
        createdCount: true,
        updatedCount: true,
        unchangedCount: true,
        conflictCount: true,
        missingCount: true,
        skippedCount: true,
        skippedSourceChangedCount: true,
        errorCode: true,
      },
    });
  }

  async identitySnapshots(): Promise<UnasProductIdentitySnapshot[]> {
    const references = await prisma.externalReference.findMany({
      where: { system: "UNAS", entityType: "Product" },
      orderBy: { externalId: "asc" },
    });
    const products = await prisma.product.findMany({
      where: { id: { in: references.map((item) => item.entityId) } },
      select: {
        id: true,
        rawSourceHash: true,
        mirrorState: true,
        variants: {
          where: { isActive: true },
          select: { sku: true, unasBaseSku: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: 1,
        },
      },
    });
    const byId = new Map(products.map((product) => [product.id, product]));
    return references.flatMap((reference) => {
      const product = byId.get(reference.entityId);
      const sku =
        reference.externalKey ??
        product?.variants[0]?.unasBaseSku ??
        product?.variants[0]?.sku;
      return product && sku
        ? [
            {
              productId: product.id,
              externalId: reference.externalId,
              sku,
              canonicalHash: product.rawSourceHash,
              mirrorState: product.mirrorState,
            },
          ]
        : [];
    });
  }

  async markFailed(runId: string, errorCode: string): Promise<void> {
    await prisma.unasProductSyncRun.updateMany({
      where: { id: runId, status: "RUNNING" },
      data: {
        activeKey: null,
        status: "FAILED",
        completedAt: new Date(),
        errorCode: errorCode.slice(0, 200),
      },
    });
  }

  async apply(
    runId: string,
    diffs: readonly UnasProductSyncDiff[],
    windowStart: Date | null,
    windowEnd: Date,
    categories: readonly UnasApiCategory[],
    deletedExternalIds: readonly string[],
    stocks: readonly UnasApiStock[],
  ): Promise<UnasProductSyncSummary> {
    return prisma.$transaction(
      async (transaction) => {
        const run = await transaction.unasProductSyncRun.findUniqueOrThrow({
          where: { id: runId },
        });
        if (run.status !== "RUNNING")
          throw new Error(`INVALID_SYNC_RUN_STATE:${run.status}`);
        if (diffs.some((diff) => diff.action === "CONFLICT"))
          throw new Error("UNAS_PRODUCT_IDENTITY_CONFLICT");

        /**
         * Egy idegen termék a listában KIMARAD, nem állítja meg a köteget.
         *
         * Eddig egyetlen olyan sor, aminek a törzsadatát már mi gondozzuk,
         * eldobta az EGÉSZ szinkront: a bolt aznap nem kapott árukészletet
         * egy termék miatt. Egy termék kihagyása a termék baja; a köteg
         * eldobása mindenkié.
         *
         * A kihagyás nem néma: számoljuk és kiírjuk, azonosítóval.
         */
        const existingProductIds = diffs.flatMap((diff) =>
          diff.action === "CREATE" ? [] : [diff.productId!],
        );
        const skippedProductIds = new Set<string>();
        const skipped: SkippedProduct[] = [];
        if (existingProductIds.length > 0) {
          const managedProducts = await transaction.product.findMany({
            where: { id: { in: existingProductIds } },
            select: { id: true, origin: true, catalogAuthority: true },
          });
          const partition = partitionByUnasAuthority(
            existingProductIds,
            managedProducts,
          );
          for (const entry of partition.skipped) {
            skipped.push(entry);
            skippedProductIds.add(entry.productId);
          }
        }

        // Materialize every UNAS category locally, including ones with
        // state "deleted". UNAS's getCategory endpoint has no state filter
        // and always returns live and deleted categories together; a live
        // category's parent can itself be deleted in UNAS. If we only
        // materialized "live" categories, a live child under a deleted
        // parent could never resolve its parentId, and the whole sync
        // transaction would fail with UNAS_CATEGORY_PARENT_NOT_FOUND. The
        // Category schema has no active/inactive flag today, so a deleted
        // UNAS category is stored as an ordinary-looking local row; only
        // its ExternalReference distinguishes it as UNAS-sourced.
        const categoryIds = new Map<string, string>();
        for (const category of categories) {
          const reference = await transaction.externalReference.findUnique({
            where: {
              system_entityType_externalId: {
                system: "UNAS",
                entityType: "Category",
                externalId: category.externalId,
              },
            },
          });
          const entity = reference
            ? await transaction.category.update({
                where: { id: reference.entityId },
                data: { name: category.name, slug: categorySlug(category) },
              })
            : await transaction.category.create({
                data: { name: category.name, slug: categorySlug(category) },
              });
          categoryIds.set(category.externalId, entity.id);
          if (reference)
            await transaction.externalReference.update({
              where: { id: reference.id },
              data: { entityId: entity.id, lastSyncedAt: windowEnd },
            });
          else
            await transaction.externalReference.create({
              data: {
                system: "UNAS",
                entityType: "Category",
                entityId: entity.id,
                externalId: category.externalId,
                lastSyncedAt: windowEnd,
              },
            });
        }
        const existingCategoryReferences =
          await transaction.externalReference.findMany({
            where: { system: "UNAS", entityType: "Category" },
          });
        for (const reference of existingCategoryReferences)
          categoryIds.set(reference.externalId, reference.entityId);
        for (const category of categories) {
          const id = categoryIds.get(category.externalId)!;
          const parentId = category.parentExternalId
            ? categoryIds.get(category.parentExternalId)
            : null;
          if (category.parentExternalId && !parentId)
            throw new Error(
              `UNAS_CATEGORY_PARENT_NOT_FOUND:child=${category.externalId}:parent=${category.parentExternalId}`,
            );
          await transaction.category.update({
            where: { id },
            data: { parentId },
          });
        }

        const counts = { CREATE: 0, UPDATE: 0, UNCHANGED: 0, CONFLICT: 0 };
        /**
         * A KIHAGYÁS ÁLLANDÓ, EZ VISZONT ESEMÉNY.
         *
         * A `skipped.length` minden futásnál ugyanazokat a termékeket számolja,
         * tehát a száma futásról futásra ugyanaz - egy szám, ami sosem
         * változik, nem jelzés, hanem alapzaj.
         *
         * Ez a számláló azt méri, hogy a kihagyottak közül hánynál változott
         * meg a FORRÁS is ugyanabban a futásban: vagyis a boltban átírtak egy
         * terméket, amit mi vettünk át, és a változás nem jött át. A legtöbb
         * futáson nulla, és pontosan akkor nem az, amikor egy termék elkezd
         * elavulni nálunk.
         *
         * Az adat itt már a kezünkben van: a kihagyás a különbség-ciklus
         * elején történik, ahol a `diff.action` értéke ismert. Nem kell hozzá
         * új lekérdezés.
         */
        let skippedSourceChanged = 0;
        for (const diff of diffs) {
          // A kihagyott termék a számlálókba sem kerül bele: nem az történt
          // vele, hogy változatlan maradt, hanem hogy hozzá sem nyúltunk.
          if (diff.productId && skippedProductIds.has(diff.productId)) {
            if (diff.action !== "UNCHANGED") skippedSourceChanged += 1;
            continue;
          }
          counts[diff.action] += 1;
          const sourceUpdatedAt = diff.product.sourceUpdatedAt
            ? new Date(diff.product.sourceUpdatedAt)
            : null;
          const sourceCreatedAt = diff.product.sourceCreatedAt
            ? new Date(diff.product.sourceCreatedAt)
            : null;
          if (diff.action === "UNCHANGED") {
            await transaction.externalReference.update({
              where: {
                system_entityType_externalId: {
                  system: "UNAS",
                  entityType: "Product",
                  externalId: diff.product.externalId,
                },
              },
              data: { lastSyncedAt: windowEnd },
            });
            continue;
          }

          const product =
            diff.action === "CREATE"
              ? await transaction.product.create({
                  data: {
                    name: diff.product.name,
                    description: diff.product.descriptionShort,
                    /**
                     * A HOSSZU LEIRAS IS BEKERUL, es ez nem uj lehivas: a mezo
                     * MAR MEGERKEZIK a UNAS-tol es a pillanatkepbe is bekerul
                     * (ugyanennek a fajlnak a 61. sora) -- eddig csak a Product
                     * rekordba nem irtuk be.
                     *
                     * MIERT KELL: merve a publikalt termekeken, 105-nek CSAK
                     * hosszu leirasa van. Azok a lapok ma URESEN erkeznenek meg
                     * a boltba, pedig a mai webshopon a `tab_description_content`
                     * blokkban ott all a szovegük.
                     */
                    descriptionLong: diff.product.descriptionLong,
                    type: "PHYSICAL",
                    origin: "UNAS",
                    catalogAuthority: "UNAS",
                    mirrorSource: "UNAS",
                    mirrorState: "ACTIVE",
                    sourceCreatedAt,
                    sourceUpdatedAt,
                    lastSyncedAt: windowEnd,
                    rawSourceHash: diff.product.canonicalHash,
                    webshopSellable: webshopSellableFromUnas(diff.product),
                  },
                })
              : await transaction.product.update({
                  where: { id: diff.productId! },
                  data: {
                    name: diff.product.name,
                    description: diff.product.descriptionShort,
                    /**
                     * A HOSSZU LEIRAS IS BEKERUL, es ez nem uj lehivas: a mezo
                     * MAR MEGERKEZIK a UNAS-tol es a pillanatkepbe is bekerul
                     * (ugyanennek a fajlnak a 61. sora) -- eddig csak a Product
                     * rekordba nem irtuk be.
                     *
                     * MIERT KELL: merve a publikalt termekeken, 105-nek CSAK
                     * hosszu leirasa van. Azok a lapok ma URESEN erkeznenek meg
                     * a boltba, pedig a mai webshopon a `tab_description_content`
                     * blokkban ott all a szovegük.
                     */
                    descriptionLong: diff.product.descriptionLong,
                    mirrorSource: "UNAS",
                    mirrorState: "ACTIVE",
                    sourceCreatedAt,
                    sourceUpdatedAt,
                    lastSyncedAt: windowEnd,
                    missingSince: null,
                    rawSourceHash: diff.product.canonicalHash,
                    webshopSellable: webshopSellableFromUnas(diff.product),
                  },
                });

          await syncProductVariants(
            transaction,
            product.id,
            diff.product,
            windowEnd,
          );

          const referenceByEntity =
            await transaction.externalReference.findUnique({
              where: {
                system_entityType_entityId: {
                  system: "UNAS",
                  entityType: "Product",
                  entityId: product.id,
                },
              },
            });
          if (referenceByEntity)
            await transaction.externalReference.update({
              where: { id: referenceByEntity.id },
              data: {
                externalId: diff.product.externalId,
                externalKey: diff.product.sku,
                lastSyncedAt: windowEnd,
              },
            });
          else
            await transaction.externalReference.create({
              data: {
                system: "UNAS",
                entityType: "Product",
                entityId: product.id,
                externalId: diff.product.externalId,
                externalKey: diff.product.sku,
                lastSyncedAt: windowEnd,
              },
            });
          await transaction.channelListing.upsert({
            where: {
              productId_channel: { productId: product.id, channel: "UNAS" },
            },
            create: {
              productId: product.id,
              channel: "UNAS",
              externalStatus: diff.product.externalStatus,
              productUrl: diff.product.productUrl,
              slug: diff.product.sefUrl,
              seoTitle: diff.product.seo.title,
              seoDescription: diff.product.seo.description,
              seoKeywords: diff.product.seo.keywords,
              seoRobots: diff.product.seo.robots,
              backorderAllowed: diff.product.backorderAllowed ?? false,
              sourceCreatedAt,
              sourceUpdatedAt,
            },
            update: {
              externalStatus: diff.product.externalStatus,
              productUrl: diff.product.productUrl,
              slug: diff.product.sefUrl,
              seoTitle: diff.product.seo.title,
              seoDescription: diff.product.seo.description,
              seoKeywords: diff.product.seo.keywords,
              seoRobots: diff.product.seo.robots,
              backorderAllowed: diff.product.backorderAllowed ?? false,
              sourceCreatedAt,
              sourceUpdatedAt,
            },
          });
          await transaction.unasProductSnapshot.upsert({
            where: { productId: product.id },
            create: {
              productId: product.id,
              ...snapshotData(diff.product, windowEnd),
            },
            update: snapshotData(diff.product, windowEnd),
          });
          if (diff.product.isPackageProduct) {
            const packageVariants = await transaction.productVariant.findMany({
              where: { productId: product.id },
              select: { id: true },
            });
            await transaction.unasStockSyncOutbox.updateMany({
              where: {
                variantId: {
                  in: packageVariants.map((variant) => variant.id),
                },
                status: {
                  in: ["PENDING", "PROCESSING", "FAILED", "DEAD_LETTER"],
                },
              },
              data: {
                status: "SUCCEEDED",
                lastError: null,
                leaseExpiresAt: null,
                resolutionNote:
                  "package_product_not_stock_managed:product_sync",
                processedAt: windowEnd,
              },
            });
          }
          const categoryExternalIds = [
            diff.product.primaryCategoryExternalId,
            ...diff.product.alternativeCategoryExternalIds,
          ].filter((item): item is string => Boolean(item));
          const resolvedCategories = categoryExternalIds.map((externalId) => {
            const categoryId = categoryIds.get(externalId);
            if (!categoryId)
              throw new Error("UNAS_CATEGORY_REFERENCE_NOT_FOUND");
            return { externalId, categoryId };
          });
          await transaction.productCategory.deleteMany({
            where: { productId: product.id, source: "UNAS" },
          });
          if (resolvedCategories.length)
            await transaction.productCategory.createMany({
              data: resolvedCategories.map((category, index) => ({
                productId: product.id,
                categoryId: category.categoryId,
                isPrimary:
                  category.externalId ===
                  diff.product.primaryCategoryExternalId,
                sortOrder: index,
                source: "UNAS",
              })),
              skipDuplicates: true,
            });
          await transaction.product.update({
            where: { id: product.id },
            data: {
              categoryId: diff.product.primaryCategoryExternalId
                ? categoryIds.get(diff.product.primaryCategoryExternalId)
                : null,
            },
          });
          const normalizedImages = diff.product.images.map((image, index) => {
            const url = absoluteHttpUrl(image.sefUrl);
            if (!url) throw new Error("UNAS_IMAGE_URL_NOT_ABSOLUTE");
            return {
              productId: product.id,
              url,
              sortOrder: image.type === "base" ? 0 : index + 1,
              altText: image.alt,
              fileName: image.filename,
              source: "UNAS",
            };
          });
          await transaction.productImage.deleteMany({
            where: { productId: product.id, source: "UNAS" },
          });
          if (normalizedImages.length)
            await transaction.productImage.createMany({
              data: normalizedImages,
              skipDuplicates: true,
            });
          await transaction.domainEvent.create({
            data: {
              id: eventId(runId, diff.action, diff.product.externalId),
              eventType:
                diff.reason === "RESTORE"
                  ? "unas-product.restored"
                  : diff.action === "CREATE"
                    ? "unas-product.created"
                    : "unas-product.updated",
              aggregateType: "Product",
              aggregateId: product.id,
              correlationId: runId,
              payload: json({
                externalId: diff.product.externalId,
                sku: diff.product.sku,
                canonicalHash: diff.product.canonicalHash,
              }),
              occurredAt: windowEnd,
            },
          });
          await writeSearchDocument(transaction, product.id);
        }

        let missingCount = 0;
        const seenExternalIds = diffs.map((diff) => diff.product.externalId);
        const missingReferences = new Map<
          string,
          { entityId: string; externalId: string }
        >();
        if (run.kind === "FULL") {
          const absent = await transaction.externalReference.findMany({
            where: {
              system: "UNAS",
              entityType: "Product",
              ...(seenExternalIds.length
                ? { externalId: { notIn: seenExternalIds } }
                : {}),
            },
          });
          for (const reference of absent)
            missingReferences.set(reference.externalId, reference);
        }
        if (deletedExternalIds.length) {
          const deleted = await transaction.externalReference.findMany({
            where: {
              system: "UNAS",
              entityType: "Product",
              externalId: { in: [...deletedExternalIds] },
            },
          });
          for (const reference of deleted)
            missingReferences.set(reference.externalId, reference);
        }
        if (missingReferences.size) {
          const missingProductIds = [
            ...new Set(
              [...missingReferences.values()].map(
                (reference) => reference.entityId,
              ),
            ),
          ];
          const managedMissingProducts = await transaction.product.findMany({
            where: { id: { in: missingProductIds } },
            select: { id: true, origin: true, catalogAuthority: true },
          });
          /**
           * A MÁSODIK fék, ugyanazzal a hibával, egy másik ágon.
           *
           * Ha csak a termék-ágat javítottuk volna, egy vegyes köteg
           * továbbra is elhasalna ITT - és a "vegyes köteg nem áll meg"
           * teszt zöld lehetne úgy, hogy a készlet-ág közben törik.
           */
          const missingPartition = partitionByUnasAuthority(
            missingProductIds,
            managedMissingProducts,
          );
          for (const entry of missingPartition.skipped) {
            skipped.push(entry);
            skippedProductIds.add(entry.productId);
          }

          for (const reference of missingReferences.values()) {
            if (skippedProductIds.has(reference.entityId)) continue;
            const result = await transaction.product.updateMany({
              where: {
                id: reference.entityId,
                OR: [
                  { mirrorState: null },
                  { mirrorState: { not: "MISSING" } },
                ],
              },
              data: {
                mirrorState: "MISSING",
                missingSince: windowEnd,
              },
            });
            if (!result.count) continue;
            missingCount += result.count;
            await transaction.domainEvent.create({
              data: {
                id: eventId(runId, "MISSING", reference.externalId),
                eventType: "unas-product.missing",
                aggregateType: "Product",
                aggregateId: reference.entityId,
                correlationId: runId,
                payload: json({ externalId: reference.externalId }),
                occurredAt: windowEnd,
              },
            });
            await writeSearchDocument(transaction, reference.entityId);
          }
        }

        // Product LastModTime and stock movements are separate UNAS
        // streams. Always apply the dedicated getStock result, including
        // when the corresponding getProduct row was UNCHANGED or absent
        // from this incremental window.
        if (stocks.length > 0) {
          const stockReferences = await transaction.externalReference.findMany({
            where: {
              system: "UNAS",
              entityType: "Product",
              externalId: {
                in: stocks.map((stock) => stock.externalId),
              },
            },
          });
          const productIdByExternalId = new Map(
            stockReferences.map((reference) => [
              reference.externalId,
              {
                productId: reference.entityId,
                sku: reference.externalKey,
              },
            ]),
          );
          for (const stock of stocks) {
            const reference = productIdByExternalId.get(stock.externalId);
            if (!reference) continue;
            if (reference.sku && reference.sku !== stock.sku)
              throw new Error("UNAS_STOCK_IDENTITY_CONFLICT");
            const key = unasVariantKey(stock.variantValues);
            const updatedVariant = await transaction.productVariant.updateMany({
              where: {
                productId: reference.productId,
                isActive: true,
                unasVariantKey: key || null,
              },
              data: {
                unasReportedStock: stock.reportedStock,
                unasReportedStockSyncedAt: windowEnd,
              },
            });
            if (updatedVariant.count !== 1)
              throw new Error(
                `UNAS_STOCK_VARIANT_NOT_RESOLVED:${stock.sku}:${key || "base"}`,
              );
            if (!key)
              await transaction.unasProductSnapshot.updateMany({
                where: { productId: reference.productId },
                data: {
                  reportedStock: stock.reportedStock,
                  reportedStockSyncedAt: windowEnd,
                },
              });
          }
        }

        await transaction.integrationCursor.upsert({
          where: { provider_stream: { provider: "UNAS", stream: "PRODUCTS" } },
          create: {
            provider: "UNAS",
            stream: "PRODUCTS",
            lastSuccessfulWindowEnd: windowEnd,
          },
          update: { lastSuccessfulWindowEnd: windowEnd },
        });
        await transaction.integrationCursor.upsert({
          where: { provider_stream: { provider: "UNAS", stream: "STOCKS" } },
          create: {
            provider: "UNAS",
            stream: "STOCKS",
            lastSuccessfulWindowEnd: windowEnd,
          },
          update: { lastSuccessfulWindowEnd: windowEnd },
        });
        await transaction.unasProductSyncRun.update({
          where: { id: runId },
          data: {
            activeKey: null,
            status: "APPLIED",
            completedAt: new Date(),
            productsSeen: diffs.length,
            createdCount: counts.CREATE,
            updatedCount: counts.UPDATE,
            unchangedCount: counts.UNCHANGED,
            conflictCount: counts.CONFLICT,
            missingCount,
            skippedCount: skipped.length,
            skippedSourceChangedCount: skippedSourceChanged,
          },
        });

        // A kihagyás nem néma: a számon kívül a termékek azonosítója is
        // kimegy, mert egy szám önmagában nem mondja meg, MELYIK maradt ki.
        if (skipped.length > 0)
          console.warn(
            `[UnasProductSync] ${skipped.length} termék kimaradt, ebből ` +
              `${skippedSourceChanged} olyan, aminél a forrás is változott ` +
              `(run ${runId}). ${describeSkipped(skipped)}`,
          );
        return {
          runId,
          status: "APPLIED",
          productsSeen: diffs.length,
          counts,
          missingCount,
          skippedCount: skipped.length,
          skippedSourceChangedCount: skippedSourceChanged,
          windowStart: windowStart?.toISOString() ?? null,
          windowEnd: windowEnd.toISOString(),
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 120_000,
      },
    );
  }
}
