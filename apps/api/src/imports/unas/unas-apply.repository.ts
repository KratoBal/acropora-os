import { createHash } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { Prisma, Repository, prisma } from "@acropora/database";
import type {
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
        if (decisions.length > 0)
          for (const review of batch.brandResolutionReviews) {
            const decision = byRow.get(review.sourceRowNumber)!;
            await transaction.brandResolutionReview.update({
              where: { id: review.id },
              data: {
                status:
                  decision.decision === "ACCEPT" ? "ACCEPTED" : "NO_BRAND",
                resolvedBrandKey:
                  decision.decision === "ACCEPT" ? decision.brandKey : null,
                reviewedBy: actorId,
                reviewedAt: now,
              },
            });
          }
        else if (
          batch.brandResolutionReviews.some(
            (review) =>
              review.status !== "ACCEPTED" && review.status !== "NO_BRAND",
          )
        )
          throw new Error("INVALID_APPROVAL_STATE:PENDING_REVIEWS");
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
    const startedAt = Date.now();
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
          unresolvedRelationReferences: 0,
          relationReferencesResolvedByCaseFallback: 0,
          relationReferencesAmbiguous: 0,
          relationReferencesSkippedAsDuplicate: 0,
          relationReferencesByField: {} as Record<string, number>,
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
          if (existingId) {
            const existingProduct = await transaction.product.findUnique({
              where: { id: existingId },
              select: { origin: true, catalogAuthority: true },
            });
            if (
              existingProduct?.origin !== "UNAS" ||
              existingProduct.catalogAuthority !== "UNAS"
            )
              throw new Error("UNAS_PRODUCT_AUTHORITY_CONFLICT");
          }
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
                  origin: "UNAS",
                  catalogAuthority: "UNAS",
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
          durationMs: Date.now() - startedAt,
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
    const brands = await transaction.brand.findMany({
      where: { isActive: true },
      include: { aliases: true },
    });
    const result = new Map<string, string>();
    for (const brand of brands) {
      const normalizedNames = [
        normalizeBrandText(brand.name),
        ...brand.aliases.map((alias) => alias.normalizedAlias),
      ];
      const entry = BRAND_DICTIONARY.find((candidate) =>
        candidate.aliases.some((alias) =>
          normalizedNames.includes(normalizeBrandText(alias)),
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
    /**
     * CSAK AZ A KET OSZLOP, AMI TENYLEG HIVATKOZAS-LISTAT TARTALMAZ.
     *
     * A lista korabban OT TOVABBI oszlopot is olvasott cikkszamkent
     * (`crosssale1..3`, `upsale1..2`). Merve a valodi munkafuzet-exportbol
     * (barracuda, 2026-09-03, `exchange/unas-teljes-export-2026-09-02/
     * termekek.xml`, 1893 adatsor): azok az oszlopok NUMBER tipusuak, 0 vagy 1
     * ertekkel -- kapcsolok, nem termekhivatkozasok. Egyetlen szoveges ertek
     * sincs bennuk a fejlecen kivul.
     *
     * A 87-es (`Kiegeszito Termekek`) es a 91-es (`Hasonlo Termekek`) oszlop
     * viszont csovel elvalasztott cikkszam-listakat tartalmaz -- ez a ketto
     * marad.
     *
     * MI TORTENT VOLNA NELKULE: a `rawText` a szam 0-t is `"0"` szoveggé
     * alakitja (nem ures string, tehat nem esik ki), a `splitReferences` pedig
     * egyelemu listat csinal belole. Vagyis MINDEN sorbol MINDEN ot oszlopbol
     * keletkezett volna egy hivatkozas: 5 * 1893 = 9465 darab, ami sosem oldodik
     * fel.
     *
     * A KAR NEM ROSSZ KAPCSOLAT LETT VOLNA: a katalogusban nincs "0" es nincs
     * "1" nevu cikkszam (merve), tehat ezek soha nem kotottek volna ossze rossz
     * termekeket. A kar a SZAMOKON van: a `unresolvedRelationReferences` 589
     * helyett tizezer korul allt volna, es a valodi vesztes elveszett volna a
     * zajban.
     *
     * ES AMI EBBOL NEM KOVETKEZIK: hogy a UNAS-ban nincs cross-sale vagy
     * up-sale. Csak az, hogy EBBEN az exportban nem termekhivatkozaskent all.
     * Ha valaha kell, az egy masik mezo lesz, es akkor NEVVEL kerul ide vissza.
     */
    const relationFields: Array<
      [string, "ACCESSORY" | "CROSS_SELL" | "SIMILAR" | "UP_SELL"]
    > = [
      ["kiegeszitotermekek", "ACCESSORY"],
      ["hasonlotermekek", "SIMILAR"],
    ];
    for (const { productId, row } of products) {
      await transaction.productRelation.deleteMany({
        where: { sourceProductId: productId, source: "UNAS" },
      });
      const seen = new Set<string>();
      for (const [field, relationType] of relationFields) {
        const references = splitReferences(rawText(row, field));
        for (const [sortOrder, sku] of references.entries()) {
          let targetProductId =
            productIdsBySku.get(sku) ??
            (
              await transaction.productVariant.findUnique({
                where: { sku },
                select: { productId: true },
              })
            )?.productId;

          /**
           * KIS-NAGYBETU FUGGETLEN VISSZAESES, CSAK PONTOS EGY TALALATNAL.
           *
           * A UNAS ugyanarra a termekre hol a katalogusbeli, hol a teljesen
           * kisbetus alakkal hivatkozik (merve: 589 hivatkozas 58 cikkszamon,
           * es ugyanezekre 1798 HELYES alaku hivatkozas is all). A pontos
           * egyezes ezeket eldobta -- csendben.
           *
           * HA TOBB TALALAT VAN, NEM TIPPELUNK. Ket termek ("ABC" es "abc")
           * eseten barmelyik valasztas onkenyes lenne, es a tevedes NEMA:
           * a kapcsolat rossz termekre mutatna, es senki nem keresne.
           *
           * ES A KIKOTES MA NEM SZUR SEMMIT, HANEM TARTALEK: a 2026-09-02
           * 22:01-es exportban 1893 termek all, 1893 egyedi pontos es 1893
           * egyedi kisbetusitett cikkszammal -- NULLA utkozes. A tobbszoros ag
           * tehat ma nem fut le; egy jovobeli katalogusra szol.
           */
          if (!targetProductId) {
            const insensitive = await transaction.productVariant.findMany({
              where: { sku: { equals: sku, mode: "insensitive" } },
              select: { productId: true },
              take: 2,
            });
            if (insensitive.length === 1) {
              targetProductId = insensitive[0]!.productId;
              counts.relationReferencesResolvedByCaseFallback += 1;
            } else if (insensitive.length > 1) {
              /**
               * AZ UTKOZES SAJAT AG, ES ITT KI IS LEP.
               *
               * Enelkul ugyanaz a hivatkozas KETSZER szamolodna: egyszer
               * utkozeskent, majd -- mivel a `targetProductId` uresen maradt --
               * megegyszer feloldatlankent, es a mezo-bontasba is bekerulne.
               *
               * A KET ESET TEENDOJE MAS, es epp ezert all kulon szamlalon:
               *   feloldatlan  -> a cikkszam nincs meg, VAGY az oszlop nem is
               *                   cikkszamokat tartalmaz (a bontas megmondja)
               *   utkozes      -> a cikkszam MEGVAN, ketszer is, kulonbozo
               *                   irasmoddal a katalogusban
               *
               * Ha az utkozes a mezo-bontasba is bekerulne, az azt sugallna,
               * hogy abbol az OSZLOPBOL jott a vesztes -- holott ott nem a
               * mezolistat kell szukiteni, hanem a KATALOGUSBAN all ket
               * osszeteveszthető cikkszam.
               *
               * A TELJES VESZTES EZERT KET SZAM OSSZEGE: a feloldatlanoke es az
               * utkozeseke. Egyik onmagaban nem mondja meg.
               */
              counts.relationReferencesAmbiguous += 1;
              continue;
            }
          }
          /**
           * A HAROM KIHAGYASI OK KOZUL CSAK AZ EGYIK HIBA.
           *
           * Eddig egyetlen `continue` kezelte mind a harmat, es ettol
           * megkulonboztethetetlen volt, hogy egy hivatkozas SZANDEKOSAN maradt
           * ki (onhivatkozas vagy duplikatum), vagy azert, mert a cikkszamot
           * NEM TALALTUK MEG. Az utobbi adatvesztes, a masik ketto nem.
           *
           * A feloldas kis-nagybetu erzekeny, tehat a nem-talalat tipikus oka
           * egy masik irasmod. Ez a szamlalo NEM javitja a parositast -- csak
           * kimondja, hogy tortent valami.
           */
          if (!targetProductId) {
            counts.unresolvedRelationReferences += 1;
            /**
             * ES MEGNEVEZZUK, MELYIK OSZLOPBOL. Egy osszeg nem valasztja szet a
             * valodi vesztest attol, ha egy oszlop egyaltalan nem cikkszamokat
             * tartalmaz -- a bontas viszont az elso futasnal megmondja.
             */
            counts.relationReferencesByField[field] =
              (counts.relationReferencesByField[field] ?? 0) + 1;
            continue;
          }
          const key = `${targetProductId}|${relationType}`;
          if (targetProductId === productId) continue;
          /**
           * A DUPLIKATUM-KIHAGYAS SZAMOLODIK, ES EZ A VISSZAESES ARA.
           *
           * A 269 ismetlodo hivatkozas mind PAR: a helyes es a kisbetus alak
           * ugyanazon a terméken. Ma a masodik tag fel sem oldodik, tehat a
           * `unresolvedRelationReferences` szamolja. A visszaeses utan
           * feloldodik, es ITT esik ki -- ha nem szamolnank, egy nema vesztest
           * cserelnenk egy masik NEMA KIHAGYASRA.
           */
          if (seen.has(key)) {
            counts.relationReferencesSkippedAsDuplicate += 1;
            continue;
          }
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
