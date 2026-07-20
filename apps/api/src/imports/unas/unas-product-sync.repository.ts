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
  UnasProductIdentitySnapshot,
  UnasProductSyncDiff,
  UnasProductSyncSummary,
} from "@acropora/types";

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
  variantStockEnabled: product.variantStockEnabled,
  lowStockThreshold: product.lowStockThreshold,
  reportedStock: product.reportedStock,
  reportedStockSyncedAt: product.reportedStock !== null ? syncedAt : undefined,
  primaryCategoryExternalId: product.primaryCategoryExternalId,
  alternativeCategoryExternalIds: json(product.alternativeCategoryExternalIds),
  images: json(product.images),
  parameters: json(product.parameters),
  seo: json(product.seo),
  rawPayload: json(product.rawPayload),
});
const ACTIVE_SYNC_KEY = "UNAS_PRODUCTS";
const STALE_RUN_AFTER_MS = 15 * 60_000;

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
          select: { sku: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: 1,
        },
      },
    });
    const byId = new Map(products.map((product) => [product.id, product]));
    return references.flatMap((reference) => {
      const product = byId.get(reference.entityId);
      const sku = product?.variants[0]?.sku ?? reference.externalKey;
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

        const categoryIds = new Map<string, string>();
        for (const category of categories.filter(
          (item) => item.state === "live",
        )) {
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
        for (const category of categories.filter(
          (item) => item.state === "live",
        )) {
          const id = categoryIds.get(category.externalId)!;
          const parentId = category.parentExternalId
            ? categoryIds.get(category.parentExternalId)
            : null;
          if (category.parentExternalId && !parentId)
            throw new Error("UNAS_CATEGORY_PARENT_NOT_FOUND");
          await transaction.category.update({
            where: { id },
            data: { parentId },
          });
        }

        const counts = { CREATE: 0, UPDATE: 0, UNCHANGED: 0, CONFLICT: 0 };
        for (const diff of diffs) {
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
                    type: "PHYSICAL",
                    mirrorSource: "UNAS",
                    mirrorState: "ACTIVE",
                    sourceCreatedAt,
                    sourceUpdatedAt,
                    lastSyncedAt: windowEnd,
                    rawSourceHash: diff.product.canonicalHash,
                    variants: {
                      create: {
                        sku: diff.product.sku,
                        name: diff.product.name,
                        unit: diff.product.unit ?? "db",
                        vatRate: diff.product.vatRate,
                        manufacturerPartNumber:
                          diff.product.manufacturerPartNumber,
                        secondaryUnit: diff.product.secondaryUnit,
                        secondaryUnitFactor: diff.product.secondaryUnitFactor,
                      },
                    },
                  },
                })
              : await transaction.product.update({
                  where: { id: diff.productId! },
                  data: {
                    name: diff.product.name,
                    description: diff.product.descriptionShort,
                    mirrorSource: "UNAS",
                    mirrorState: "ACTIVE",
                    sourceCreatedAt,
                    sourceUpdatedAt,
                    lastSyncedAt: windowEnd,
                    missingSince: null,
                    rawSourceHash: diff.product.canonicalHash,
                  },
                });

          if (diff.action === "UPDATE") {
            const variants = await transaction.productVariant.findMany({
              where: { productId: product.id },
              select: { id: true },
              orderBy: [{ createdAt: "asc" }, { id: "asc" }],
              take: 2,
            });
            if (variants.length !== 1)
              throw new Error("UNAS_MIRROR_VARIANT_CARDINALITY");
            await transaction.productVariant.update({
              where: { id: variants[0]!.id },
              data: {
                sku: diff.product.sku,
                name: diff.product.name,
                unit: diff.product.unit ?? "db",
                vatRate: diff.product.vatRate,
                manufacturerPartNumber: diff.product.manufacturerPartNumber,
                secondaryUnit: diff.product.secondaryUnit,
                secondaryUnitFactor: diff.product.secondaryUnitFactor,
              },
            });
          }

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
          for (const reference of missingReferences.values()) {
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
          },
        });
        return {
          runId,
          status: "APPLIED",
          productsSeen: diffs.length,
          counts,
          missingCount,
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
