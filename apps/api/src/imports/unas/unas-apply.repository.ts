import { createHash } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { Prisma, Repository, prisma } from "@acropora/database";
import type {
  BrandResolutionResult,
  UnasApplySummary,
  UnasImportReport,
  UnasProductImportRow,
} from "@acropora/types";

import { BRAND_DICTIONARY } from "./brand-resolution/brand-dictionary.js";
import { normalizeBrandText } from "./brand-resolution/brand-normalizer.js";

export interface BrandReviewDecision {
  sourceRowNumber: number;
  decision: "ACCEPT" | "NO_BRAND";
  brandKey?: string;
}

const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const parsed = <T>(value: Prisma.JsonValue) => value as unknown as T;
const slug = (value: string) =>
  normalizeBrandText(value).replace(/ /g, "-") || "category";
const stableId = (...parts: string[]) =>
  createHash("sha256").update(parts.join("|")).digest("hex");
const rawText = (row: UnasProductImportRow, key: string) => {
  const value = row.rawPayload[key];
  return String(value ?? "").trim() || undefined;
};
const splitReferences = (value?: string) =>
  (value ?? "")
    .split(/[|;,]/)
    .map((item) => item.trim())
    .filter(Boolean);

@Injectable()
export class UnasApplyRepository extends Repository {
  constructor() {
    super(prisma);
  }

  getBatch(batchId: string) {
    return prisma.catalogImportBatch.findUnique({
      where: { id: batchId },
      include: {
        rows: { orderBy: [{ entityType: "asc" }, { sourceRowNumber: "asc" }] },
        brandResolutionReviews: { orderBy: { sourceRowNumber: "asc" } },
      },
    });
  }

  async approve(
    batchId: string,
    actorId: string,
    decisions: BrandReviewDecision[],
  ) {
    return prisma.$transaction(
      async (transaction) => {
        const batch = await transaction.catalogImportBatch.findUniqueOrThrow({
          where: { id: batchId },
          include: { brandResolutionReviews: true },
        });
        if (batch.status === "APPROVED") return batch;
        if (batch.status !== "VALIDATED")
          throw new Error(`INVALID_APPROVAL_STATE:${batch.status}`);
        const byRow = new Map(
          decisions.map((decision) => [decision.sourceRowNumber, decision]),
        );
        const now = new Date();
        for (const review of batch.brandResolutionReviews) {
          const decision = byRow.get(review.sourceRowNumber)!;
          await transaction.brandResolutionReview.update({
            where: { id: review.id },
            data: {
              status: decision.decision === "ACCEPT" ? "ACCEPTED" : "NO_BRAND",
              resolvedBrandKey:
                decision.decision === "ACCEPT" ? decision.brandKey : null,
              reviewedBy: actorId,
              reviewedAt: now,
            },
          });
        }
        return transaction.catalogImportBatch.update({
          where: { id: batchId },
          data: { status: "APPROVED", approvedBy: actorId, approvedAt: now },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async markStale(batchId: string) {
    return prisma.catalogImportBatch.updateMany({
      where: { id: batchId, status: { in: ["VALIDATED", "APPROVED"] } },
      data: { status: "STALE" },
    });
  }

  async apply(
    batchId: string,
    actorId: string,
    expectedAnalysisVersion: string,
  ): Promise<UnasApplySummary> {
    return prisma.$transaction(
      async (transaction) => {
        const batch = await transaction.catalogImportBatch.findUniqueOrThrow({
          where: { id: batchId },
          include: {
            rows: { orderBy: { sourceRowNumber: "asc" } },
            brandResolutionReviews: true,
          },
        });
        if (batch.status === "APPLIED" && batch.applyReport)
          return parsed<UnasApplySummary>(batch.applyReport);
        if (batch.status !== "APPROVED")
          throw new Error(`INVALID_APPLY_STATE:${batch.status}`);
        if (batch.analysisVersion !== expectedAnalysisVersion)
          throw new Error("STALE_ANALYSIS_VERSION");
        if (batch.rows.some((row) => row.status === "INVALID"))
          throw new Error("VALIDATION_ERRORS");
        if (
          batch.brandResolutionReviews.some(
            (review) => review.status === "PENDING",
          )
        )
          throw new Error("PENDING_BRAND_REVIEWS");

        const report = parsed<UnasImportReport>(batch.report!);
        if (report.summary.validationErrors > 0)
          throw new Error("VALIDATION_ERRORS");
        const categories = batch.rows
          .filter((row) => row.entityType === "CATEGORY")
          .map((row) => parsed<CategoryRow>(row.parsedPayload));
        const products = batch.rows
          .filter((row) => row.entityType === "PRODUCT")
          .map((row) => parsed<UnasProductImportRow>(row.parsedPayload));

        const counts = {
          categoriesCreated: 0,
          categoriesUpdated: 0,
          productsCreated: 0,
          productsUpdated: 0,
          variantsCreated: 0,
          imagesSynchronized: 0,
          categoryLinksSynchronized: 0,
          relationsSynchronized: 0,
          channelListingsSynchronized: 0,
          externalReferencesSynchronized: 0,
          domainEventsCreated: 0,
          unresolvedBrandAssociations: 0,
        };
        const categoryIds = await this.upsertCategories(
          transaction,
          categories,
          counts,
        );
        const brandIds = await this.brandIdsByDictionaryKey(transaction);
        const resolutionByRow = new Map(
          (report.brandResolution?.products ?? []).map((resolution) => [
            resolution.sourceRowNumber,
            resolution,
          ]),
        );
        const reviewByRow = new Map(
          batch.brandResolutionReviews.map((review) => [
            review.sourceRowNumber,
            review,
          ]),
        );
        const productIdsBySku = new Map<string, string>();
        const relations: Array<{
          productId: string;
          row: UnasProductImportRow;
        }> = [];

        for (const row of products) {
          const externalId = row.externalId ?? row.sku;
          const existingReference =
            await transaction.externalReference.findUnique({
              where: {
                system_entityType_externalId: {
                  system: "UNAS",
                  entityType: "Product",
                  externalId,
                },
              },
            });
          const existingVariant = await transaction.productVariant.findUnique({
            where: { sku: row.sku },
            select: { productId: true },
          });
          const existingId =
            existingReference?.entityId ?? existingVariant?.productId;
          const resolution = resolutionByRow.get(row.sourceRowNumber);
          const review = reviewByRow.get(row.sourceRowNumber);
          const brandKey = review
            ? review.status === "ACCEPTED"
              ? review.resolvedBrandKey
              : null
            : resolution?.selectedBrandKey;
          const brandId = brandKey ? brandIds.get(brandKey) : undefined;
          if (brandKey && !brandId) counts.unresolvedBrandAssociations += 1;
          const product = existingId
            ? await transaction.product.update({
                where: { id: existingId },
                data: {
                  name: row.name,
                  description: row.description,
                  ...(brandId ? { brandId } : {}),
                },
              })
            : await transaction.product.create({
                data: {
                  name: row.name,
                  description: row.description,
                  type: "PHYSICAL",
                  brandId: brandId ?? null,
                },
              });
          existingId
            ? (counts.productsUpdated += 1)
            : (counts.productsCreated += 1);
          const variant = await transaction.productVariant.findUnique({
            where: { sku: row.sku },
          });
          if (variant)
            await transaction.productVariant.update({
              where: { id: variant.id },
              data: { productId: product.id, name: row.name },
            });
          else {
            await transaction.productVariant.create({
              data: { productId: product.id, sku: row.sku, name: row.name },
            });
            counts.variantsCreated += 1;
          }
          productIdsBySku.set(row.sku, product.id);
          await transaction.externalReference.upsert({
            where: {
              system_entityType_externalId: {
                system: "UNAS",
                entityType: "Product",
                externalId,
              },
            },
            create: {
              system: "UNAS",
              entityType: "Product",
              entityId: product.id,
              externalId,
              externalKey: row.sku,
              lastSyncedAt: new Date(),
            },
            update: {
              entityId: product.id,
              externalKey: row.sku,
              lastSyncedAt: new Date(),
            },
          });
          counts.externalReferencesSynchronized += 1;
          await this.syncProductDetails(
            transaction,
            product.id,
            row,
            categoryIds,
            counts,
          );
          const eventType = existingId ? "product.updated" : "product.created";
          await transaction.domainEvent.create({
            data: {
              id: stableId(batchId, eventType, product.id),
              eventType,
              aggregateType: "Product",
              aggregateId: product.id,
              correlationId: batchId,
              payload: json({
                source: "UNAS",
                sku: row.sku,
                name: row.name,
                batchId,
                ...(eventType === "product.created"
                  ? { productType: "PHYSICAL" }
                  : {}),
              }),
              occurredAt: new Date(),
            },
          });
          counts.domainEventsCreated += 1;
          relations.push({ productId: product.id, row });
        }

        await this.syncRelations(
          transaction,
          relations,
          productIdsBySku,
          counts,
        );
        await transaction.domainEvent.create({
          data: {
            id: stableId(batchId, "catalog-import.applied"),
            eventType: "catalog-import.applied",
            aggregateType: "CatalogImportBatch",
            aggregateId: batchId,
            correlationId: batchId,
            payload: json({
              provider: "UNAS",
              productCount: products.length,
              categoryCount: categories.length,
              ...counts,
            }),
            occurredAt: new Date(),
          },
        });
        counts.domainEventsCreated += 1;
        const appliedAt = new Date();
        const result: UnasApplySummary = {
          batchId,
          status: "APPLIED",
          ...counts,
          appliedAt: appliedAt.toISOString(),
          appliedBy: actorId,
        };
        await transaction.catalogImportBatch.update({
          where: { id: batchId },
          data: {
            status: "APPLIED",
            appliedAt,
            appliedBy: actorId,
            applyReport: json(result),
          },
        });
        return result;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 120_000,
        maxWait: 10_000,
      },
    );
  }

  private async upsertCategories(
    transaction: Prisma.TransactionClient,
    categories: CategoryRow[],
    counts: MutableCounts,
  ) {
    const ids = new Map<string, string>();
    for (const row of categories) {
      const reference = await transaction.externalReference.findUnique({
        where: {
          system_entityType_externalId: {
            system: "UNAS",
            entityType: "Category",
            externalId: row.externalId,
          },
        },
      });
      const category = reference
        ? await transaction.category.update({
            where: { id: reference.entityId },
            data: { name: row.name },
          })
        : await transaction.category.create({
            data: {
              name: row.name,
              slug: `unas-${row.externalId}-${slug(row.name)}`,
            },
          });
      reference
        ? (counts.categoriesUpdated += 1)
        : (counts.categoriesCreated += 1);
      ids.set(row.externalId, category.id);
      await transaction.externalReference.upsert({
        where: {
          system_entityType_externalId: {
            system: "UNAS",
            entityType: "Category",
            externalId: row.externalId,
          },
        },
        create: {
          system: "UNAS",
          entityType: "Category",
          entityId: category.id,
          externalId: row.externalId,
          lastSyncedAt: new Date(),
        },
        update: { entityId: category.id, lastSyncedAt: new Date() },
      });
      counts.externalReferencesSynchronized += 1;
    }
    for (const row of categories)
      await transaction.category.update({
        where: { id: ids.get(row.externalId)! },
        data: {
          parentId: row.parentExternalId
            ? (ids.get(row.parentExternalId) ?? null)
            : null,
        },
      });
    return ids;
  }

  private async brandIdsByDictionaryKey(transaction: Prisma.TransactionClient) {
    const brands = await transaction.brand.findMany();
    const result = new Map<string, string>();
    for (const brand of brands) {
      const normalized = normalizeBrandText(brand.name);
      const entry = BRAND_DICTIONARY.find((candidate) =>
        candidate.aliases.some(
          (alias) => normalizeBrandText(alias) === normalized,
        ),
      );
      if (entry) result.set(entry.key, brand.id);
    }
    return result;
  }

  private async syncProductDetails(
    transaction: Prisma.TransactionClient,
    productId: string,
    row: UnasProductImportRow,
    categoryIds: Map<string, string>,
    counts: MutableCounts,
  ) {
    const categoryExternalIds = [
      row.primaryCategoryExternalId,
      ...(row.alternativeCategoryExternalIds ?? []),
    ].filter((value): value is string => Boolean(value));
    const uniqueCategories = [...new Set(categoryExternalIds)];
    await transaction.productCategory.deleteMany({
      where: { productId, source: "UNAS" },
    });
    await transaction.productCategory.updateMany({
      where: { productId, isPrimary: true },
      data: { isPrimary: false },
    });
    for (const [index, externalId] of uniqueCategories.entries()) {
      const categoryId = categoryIds.get(externalId);
      if (!categoryId) continue;
      const existingLink = await transaction.productCategory.findUnique({
        where: { productId_categoryId: { productId, categoryId } },
      });
      if (existingLink)
        await transaction.productCategory.update({
          where: { id: existingLink.id },
          data: {
            isPrimary: externalId === row.primaryCategoryExternalId,
            sortOrder: index,
          },
        });
      else
        await transaction.productCategory.create({
          data: {
            productId,
            categoryId,
            isPrimary: externalId === row.primaryCategoryExternalId,
            sortOrder: index,
            source: "UNAS",
          },
        });
      counts.categoryLinksSynchronized += 1;
    }
    await transaction.product.update({
      where: { id: productId },
      data: {
        categoryId: row.primaryCategoryExternalId
          ? (categoryIds.get(row.primaryCategoryExternalId) ?? null)
          : null,
      },
    });
    await transaction.productImage.deleteMany({
      where: { productId, source: "UNAS" },
    });
    const existingImageUrls = new Set(
      (
        await transaction.productImage.findMany({
          where: { productId },
          select: { url: true },
        })
      ).map((image) => image.url),
    );
    const newImages = (row.imageUrls ?? []).filter(
      (url) => !existingImageUrls.has(url),
    );
    if (newImages.length)
      await transaction.productImage.createMany({
        data: newImages.map((url, sortOrder) => ({
          productId,
          url,
          sortOrder,
          source: "UNAS",
        })),
      });
    counts.imagesSynchronized += newImages.length;
    await transaction.channelListing.upsert({
      where: { productId_channel: { productId, channel: "UNAS" } },
      create: {
        productId,
        channel: "UNAS",
        externalStatus: row.externalStatus,
        slug: rawText(row, "sefurl"),
        productUrl: rawText(row, "termeklink"),
        seoTitle: rawText(row, "seotitle"),
        seoDescription: rawText(row, "seodescription"),
        seoKeywords: rawText(row, "seokeywords"),
        seoRobots: rawText(row, "seorobots"),
      },
      update: {
        externalStatus: row.externalStatus,
        slug: rawText(row, "sefurl"),
        productUrl: rawText(row, "termeklink"),
        seoTitle: rawText(row, "seotitle"),
        seoDescription: rawText(row, "seodescription"),
        seoKeywords: rawText(row, "seokeywords"),
        seoRobots: rawText(row, "seorobots"),
      },
    });
    counts.channelListingsSynchronized += 1;
  }

  private async syncRelations(
    transaction: Prisma.TransactionClient,
    products: Array<{ productId: string; row: UnasProductImportRow }>,
    productIdsBySku: Map<string, string>,
    counts: MutableCounts,
  ) {
    const relationFields: Array<
      [string, "ACCESSORY" | "CROSS_SELL" | "SIMILAR" | "UP_SELL"]
    > = [
      ["kiegeszitotermekek", "ACCESSORY"],
      ["crosssale1", "CROSS_SELL"],
      ["crosssale2", "CROSS_SELL"],
      ["crosssale3", "CROSS_SELL"],
      ["hasonlotermekek", "SIMILAR"],
      ["upsale1", "UP_SELL"],
      ["upsale2", "UP_SELL"],
    ];
    for (const { productId, row } of products) {
      await transaction.productRelation.deleteMany({
        where: { sourceProductId: productId, source: "UNAS" },
      });
      const seen = new Set<string>();
      for (const [field, relationType] of relationFields) {
        const references = splitReferences(rawText(row, field));
        for (const [sortOrder, sku] of references.entries()) {
          const targetProductId =
            productIdsBySku.get(sku) ??
            (
              await transaction.productVariant.findUnique({
                where: { sku },
                select: { productId: true },
              })
            )?.productId;
          const key = `${targetProductId}|${relationType}`;
          if (
            !targetProductId ||
            targetProductId === productId ||
            seen.has(key)
          )
            continue;
          seen.add(key);
          const existing = await transaction.productRelation.findUnique({
            where: {
              sourceProductId_targetProductId_relationType: {
                sourceProductId: productId,
                targetProductId,
                relationType,
              },
            },
          });
          if (existing) continue;
          await transaction.productRelation.create({
            data: {
              sourceProductId: productId,
              targetProductId,
              relationType,
              sortOrder,
              source: "UNAS",
            },
          });
          counts.relationsSynchronized += 1;
        }
      }
    }
  }
}

interface CategoryRow {
  externalId: string;
  name: string;
  parentExternalId?: string;
}

type MutableCounts = Omit<
  UnasApplySummary,
  "batchId" | "status" | "appliedAt" | "appliedBy"
>;
