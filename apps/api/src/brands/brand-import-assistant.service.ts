import { createHash, randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";
import type {
  BrandImportAssistantResponse,
  BrandImportAssistantRow,
  BrandImportClassification,
  BrandSummary,
  BulkBrandCreateResponse,
  BulkBrandCreateResult,
  BulkBrandCreateStatus,
  UnasProductImportRow,
} from "@acropora/types";
import { BRAND_RESOLUTION_VERSIONS } from "../imports/unas/brand-resolution/brand-resolution.config.js";
import { normalizeBrandName } from "./brands.repository.js";
import type {
  BrandImportRowsQueryDto,
  BulkCreateImportBrandsDto,
  CreateBrandFromImportDto,
  MapImportAliasDto,
  MapImportExternalDto,
} from "./dto/brand-import-assistant.dto.js";

const rowId = (normalized: string) =>
  createHash("sha256").update(normalized).digest("hex").slice(0, 24);
const completed = new Set<BrandImportClassification>([
  "EXACT_CANONICAL_MATCH",
  "ALIAS_MATCH",
  "EXTERNAL_MAPPING_MATCH",
]);

@Injectable()
export class BrandImportAssistantService {
  async batches() {
    const batches = await prisma.catalogImportBatch.findMany({
      where: { provider: "UNAS", status: { in: ["VALIDATED", "APPROVED"] } },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      select: {
        id: true,
        sourceFileName: true,
        status: true,
        analysisVersion: true,
        createdAt: true,
      },
    });
    return batches.map((batch) => ({
      ...batch,
      createdAt: batch.createdAt.toISOString(),
    }));
  }
  async rows(
    batchId: string,
    query: BrandImportRowsQueryDto,
  ): Promise<BrandImportAssistantResponse> {
    const analyzed = await this.analyze(batchId);
    let rows = analyzed.rows;
    const needle = query.search?.trim().toLowerCase();
    rows = rows.filter(
      (row) =>
        (!query.classification ||
          row.classification === query.classification) &&
        (!query.sourceValue ||
          row.normalizedSourceValue ===
            normalizeBrandName(query.sourceValue)) &&
        (!query.targetBrandId ||
          row.matchedBrand?.id === query.targetBrandId ||
          row.candidates.some((brand) => brand.id === query.targetBrandId)) &&
        (!needle ||
          [
            row.sourceValue,
            row.normalizedSourceValue,
            row.proposedCanonicalName,
            row.matchedBrand?.name,
            row.matchedAlias,
            row.externalMapping?.externalId,
            ...row.candidates.map((brand) => brand.name),
          ].some((value) => value?.toLowerCase().includes(needle))),
    );
    const start = (query.page - 1) * query.pageSize;
    return {
      items: rows.slice(start, start + query.pageSize),
      summary: analyzed.summary,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        totalItems: rows.length,
        totalPages: Math.ceil(rows.length / query.pageSize),
      },
    };
  }
  async summary(batchId: string) {
    return (await this.analyze(batchId)).summary;
  }

  async createBrand(
    batchId: string,
    id: string,
    input: CreateBrandFromImportDto,
    actorId: string,
  ) {
    await this.assertMutableBatch(batchId);
    const row = await this.currentRow(batchId, id, input.expectedUpdatedAt);
    if (row.classification !== "MISSING_BRAND")
      throw new ConflictException(
        "Csak hiányzó, konfliktusmentes márkából hozható létre új rekord.",
      );
    const name = input.canonicalName.trim();
    if (!name) throw new BadRequestException("A kanonikus név kötelező.");
    if (input.createExternalMapping)
      throw new BadRequestException(
        "Ehhez a forrásértékhez nincs igazolt stabil UNAS márkaazonosító.",
      );
    try {
      const brand = await prisma.$transaction(
        async (tx) => {
          const normalizedName = normalizeBrandName(name);
          await this.assertIdentityFree(tx, normalizedName);
          const created = await tx.brand.create({
            data: {
              name,
              normalizedName,
              slug: normalizedName.replace(/ /g, "-"),
              aliases:
                input.createAlias &&
                normalizeBrandName(row.sourceValue) !== normalizedName
                  ? {
                      create: {
                        alias: row.sourceValue,
                        normalizedAlias: row.normalizedSourceValue,
                        source: "UNAS",
                        isPreferred: true,
                      },
                    }
                  : undefined,
            },
          });
          await tx.domainEvent.create({
            data: {
              id: randomUUID(),
              eventType: "brand.created",
              aggregateType: "Brand",
              aggregateId: created.id,
              actorUserId: actorId,
              correlationId: batchId,
              payload: {
                name,
                source: "UNAS_IMPORT_ASSISTANT",
                sourceValue: row.sourceValue,
              },
              occurredAt: new Date(),
            },
          });
          return created;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return {
        row: await this.reclassified(batchId, id),
        createdBrands: [{ id: brand.id, name: brand.name }],
      };
    } catch (error) {
      this.map(error);
    }
  }

  async mapAlias(
    batchId: string,
    id: string,
    input: MapImportAliasDto,
    actorId: string,
  ) {
    await this.assertMutableBatch(batchId);
    const row = await this.currentRow(batchId, id, input.expectedUpdatedAt);
    const brand = await prisma.brand.findUnique({
      where: { id: input.brandId },
    });
    if (!brand) throw new NotFoundException("A célmárka nem található.");
    if (!brand.isActive)
      throw new ConflictException("Archivált márkához nem adható új alias.");
    try {
      await prisma.$transaction(
        async (tx) => {
          await this.assertIdentityFree(
            tx,
            row.normalizedSourceValue,
            brand.id,
          );
          await tx.brandAlias.create({
            data: {
              brandId: brand.id,
              alias: row.sourceValue,
              normalizedAlias: row.normalizedSourceValue,
              source: "UNAS",
              isPreferred: true,
            },
          });
          await tx.domainEvent.create({
            data: {
              id: randomUUID(),
              eventType: "brand.alias-added",
              aggregateType: "Brand",
              aggregateId: brand.id,
              actorUserId: actorId,
              correlationId: batchId,
              payload: {
                alias: row.sourceValue,
                source: "UNAS",
                sourceRowId: id,
              },
              occurredAt: new Date(),
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return { row: await this.reclassified(batchId, id) };
    } catch (error) {
      this.map(error);
    }
  }

  async mapExternal(
    batchId: string,
    id: string,
    input: MapImportExternalDto,
    actorId: string,
  ) {
    await this.assertMutableBatch(batchId);
    const row = await this.currentRow(batchId, id, input.expectedUpdatedAt);
    if (
      !row.externalMapping ||
      row.externalMapping.externalId !== input.externalId
    )
      throw new BadRequestException(
        "Külső megfeleltetés csak a batchből igazolt stabil UNAS azonosítóval menthető.",
      );
    const brand = await prisma.brand.findUnique({
      where: { id: input.brandId },
    });
    if (!brand?.isActive)
      throw new ConflictException("Csak aktív célmárka választható.");
    try {
      await prisma.$transaction(async (tx) => {
        const owned = await tx.externalReference.findUnique({
          where: {
            system_entityType_externalId: {
              system: "UNAS",
              entityType: "BRAND",
              externalId: input.externalId,
            },
          },
        });
        if (owned && owned.entityId !== brand.id)
          throw new Error("MAPPING_CONFLICT");
        await tx.externalReference.upsert({
          where: {
            system_entityType_externalId: {
              system: "UNAS",
              entityType: "BRAND",
              externalId: input.externalId,
            },
          },
          create: {
            system: "UNAS",
            entityType: "BRAND",
            entityId: brand.id,
            externalId: input.externalId,
            externalKey: row.sourceValue,
          },
          update: { entityId: brand.id, externalKey: row.sourceValue },
        });
        await tx.domainEvent.create({
          data: {
            id: randomUUID(),
            eventType: "brand.external-reference-added",
            aggregateType: "Brand",
            aggregateId: brand.id,
            actorUserId: actorId,
            correlationId: batchId,
            payload: {
              system: "UNAS",
              externalId: input.externalId,
              sourceValue: row.sourceValue,
            },
            occurredAt: new Date(),
          },
        });
      });
      return { row: await this.reclassified(batchId, id) };
    } catch (error) {
      this.map(error);
    }
  }

  async bulkCreate(
    batchId: string,
    input: BulkCreateImportBrandsDto,
    actorId: string,
  ): Promise<BulkBrandCreateResponse> {
    await this.assertMutableBatch(batchId);
    if (new Set(input.rowIds).size !== input.rowIds.length)
      throw new BadRequestException("Duplikált sorazonosító.");
    const initialRows = new Map(
      (await this.analyze(batchId)).rows.map((row) => [row.id, row]),
    );
    const results: BulkBrandCreateResult[] = [];

    for (const sourceBrandId of input.rowIds) {
      const initial = initialRows.get(sourceBrandId);
      if (!initial) {
        results.push({
          sourceBrandId,
          sourceName: "Ismeretlen forrásmárka",
          status: "SKIPPED",
          reason: "A stabil forrásazonosító nem tartozik a batchhez.",
        });
        continue;
      }

      const current = initial;
      if (completed.has(current.classification) && current.matchedBrand) {
        results.push({
          sourceBrandId,
          sourceName: current.sourceValue,
          targetBrandId: current.matchedBrand.id,
          status: "ALREADY_RESOLVED",
          reason: "A forrásmárka időközben már biztonságosan feloldódott.",
        });
        continue;
      }
      if (current.classification !== "MISSING_BRAND") {
        results.push({
          sourceBrandId,
          sourceName: current.sourceValue,
          targetBrandId: current.matchedBrand?.id,
          status: "CONFLICT",
          reason: `A jelenlegi besorolás kézi feloldást igényel: ${current.classification}.`,
        });
        continue;
      }
      if (input.expectedUpdatedAt[sourceBrandId] !== current.updatedAt) {
        results.push({
          sourceBrandId,
          sourceName: current.sourceValue,
          status: "CONFLICT",
          reason: "A forrásmárka állapota a kijelölés óta megváltozott.",
        });
        continue;
      }

      try {
        const created = await prisma.$transaction(
          async (tx) => {
            await this.assertIdentityFree(tx, current.normalizedSourceValue);
            const brand = await tx.brand.create({
              data: {
                name: current.proposedCanonicalName,
                normalizedName: normalizeBrandName(
                  current.proposedCanonicalName,
                ),
                slug: normalizeBrandName(current.proposedCanonicalName).replace(
                  / /g,
                  "-",
                ),
              },
            });
            await tx.domainEvent.create({
              data: {
                id: randomUUID(),
                eventType: "brand.created",
                aggregateType: "Brand",
                aggregateId: brand.id,
                actorUserId: actorId,
                correlationId: batchId,
                payload: {
                  name: brand.name,
                  source: "UNAS_IMPORT_ASSISTANT_BULK",
                  sourceBrandId,
                  sourceValue: current.sourceValue,
                },
                occurredAt: new Date(),
              },
            });
            return brand;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
        results.push({
          sourceBrandId,
          sourceName: current.sourceValue,
          targetBrandId: created.id,
          status: "CREATED",
          reason: "Új Brand Master rekord létrejött.",
        });
      } catch (error) {
        const refreshed = (await this.analyze(batchId)).rows.find(
          (row) => row.id === sourceBrandId,
        );
        if (
          refreshed &&
          completed.has(refreshed.classification) &&
          refreshed.matchedBrand
        ) {
          results.push({
            sourceBrandId,
            sourceName: refreshed.sourceValue,
            targetBrandId: refreshed.matchedBrand.id,
            status: "ALREADY_RESOLVED",
            reason: "Párhuzamos művelet közben már létrejött az egyezés.",
          });
        } else if (
          (error instanceof Prisma.PrismaClientKnownRequestError &&
            ["P2002", "P2034"].includes(error.code)) ||
          (error instanceof Error && error.message === "IDENTITY_CONFLICT")
        ) {
          results.push({
            sourceBrandId,
            sourceName: current.sourceValue,
            status: "CONFLICT",
            reason:
              "A normalizált márkaidentitást egy párhuzamos művelet lefoglalta.",
          });
        } else {
          results.push({
            sourceBrandId,
            sourceName: current.sourceValue,
            status: "FAILED",
            reason:
              "A márka létrehozása váratlan adatbázishiba miatt sikertelen.",
          });
        }
      }
    }

    const summary = this.bulkSummary(results);
    await prisma.auditLog.create({
      data: {
        userId: actorId,
        action: "brand.import-assistant.bulk-create",
        entityType: "CatalogImportBatch",
        entityId: batchId,
        metadata: {
          requestedCount: input.rowIds.length,
          ...summary,
        },
      },
    });
    return {
      batchId,
      requestedCount: input.rowIds.length,
      results,
      summary,
    };
  }

  private bulkSummary(results: BulkBrandCreateResult[]) {
    const summary: Record<BulkBrandCreateStatus, number> = {
      CREATED: 0,
      ALREADY_RESOLVED: 0,
      SKIPPED: 0,
      CONFLICT: 0,
      FAILED: 0,
    };
    for (const result of results) summary[result.status] += 1;
    return summary;
  }

  private async analyze(batchId: string) {
    const batch = await prisma.catalogImportBatch.findUnique({
      where: { id: batchId },
      include: {
        rows: {
          where: { entityType: "PRODUCT" },
          orderBy: { sourceRowNumber: "asc" },
        },
      },
    });
    if (!batch || batch.provider !== "UNAS")
      throw new NotFoundException("Az UNAS import batch nem található.");
    const [brands, mappings] = await Promise.all([
      prisma.brand.findMany({
        include: { aliases: true, _count: { select: { products: true } } },
        orderBy: [{ name: "asc" }, { id: "asc" }],
      }),
      prisma.externalReference.findMany({
        where: { system: "UNAS", entityType: "BRAND" },
      }),
    ]);
    const groups = new Map<
      string,
      {
        values: string[];
        examples: Array<{
          sku: string;
          productName: string;
          sourceRowNumber: number;
        }>;
      }
    >();
    for (const staged of batch.rows) {
      const row = staged.parsedPayload as unknown as UnasProductImportRow;
      const source = row.brandName?.trim();
      if (!source) continue;
      const key = normalizeBrandName(source);
      const group = groups.get(key) ?? { values: [], examples: [] };
      group.values.push(source);
      group.examples.push({
        sku: row.sku,
        productName: row.name,
        sourceRowNumber: row.sourceRowNumber,
      });
      groups.set(key, group);
    }
    const summaries = await Promise.all(
      brands.map((brand) => this.brandSummary(brand, mappings)),
    );
    const rows = [...groups.entries()]
      .map(([normalized, group]) =>
        this.classify(batch, normalized, group, summaries, mappings),
      )
      .sort(
        (a, b) =>
          a.sourceValue.localeCompare(b.sourceValue, "hu") ||
          a.id.localeCompare(b.id),
      );
    const classifications = Object.fromEntries(
      [
        "EXACT_CANONICAL_MATCH",
        "ALIAS_MATCH",
        "EXTERNAL_MAPPING_MATCH",
        "MISSING_BRAND",
        "AMBIGUOUS",
        "ARCHIVED_MATCH",
        "CONFLICT",
      ].map((key) => [key, 0]),
    ) as Record<BrandImportClassification, number>;
    for (const row of rows) classifications[row.classification] += 1;
    const complete = rows.filter((row) =>
      completed.has(row.classification),
    ).length;
    return {
      rows,
      summary: {
        total: rows.length,
        classifications,
        completed: complete,
        unresolved: rows.length - complete,
        completionPercent: rows.length
          ? Math.round((complete / rows.length) * 100)
          : 100,
        batch: {
          id: batch.id,
          sourceFileName: batch.sourceFileName,
          status: batch.status,
          analysisVersion: batch.analysisVersion,
          createdAt: batch.createdAt.toISOString(),
        },
      },
    };
  }

  classify(
    batch: { updatedAt: Date; analysisVersion: string },
    normalized: string,
    group: {
      values: string[];
      examples: Array<{
        sku: string;
        productName: string;
        sourceRowNumber: number;
      }>;
    },
    brands: BrandSummary[],
    mappings: Array<{
      id: string;
      entityId: string;
      externalId: string;
      externalKey: string | null;
      updatedAt: Date;
    }>,
  ): BrandImportAssistantRow {
    const canonical = brands.filter(
      (brand) => brand.normalizedName === normalized,
    );
    const alias = brands.filter((brand) =>
      brand.aliases.some((item) => item.normalizedAlias === normalized),
    );
    const external = mappings.find(
      (item) =>
        item.externalKey && normalizeBrandName(item.externalKey) === normalized,
    );
    const externalBrand = external
      ? brands.find((brand) => brand.id === external.entityId)
      : undefined;
    const matches = [
      ...new Map(
        [...canonical, ...alias, ...(externalBrand ? [externalBrand] : [])].map(
          (brand) => [brand.id, brand],
        ),
      ).values(),
    ];
    const sourceTokens = new Set(
      normalized.split(" ").filter((token) => token.length > 2),
    );
    const plausible = brands.filter(
      (brand) =>
        brand.isActive &&
        !matches.some((match) => match.id === brand.id) &&
        brand.normalizedName
          .split(" ")
          .some((token) => token.length > 2 && sourceTokens.has(token)),
    );
    let classification: BrandImportClassification;
    let matched = matches[0];
    const reasoning: string[] = [];
    if (matches.length > 1) {
      classification = "CONFLICT";
      reasoning.push("Több master-data tulajdonos egyezik a forrásértékkel.");
    } else if (matched && !matched.isActive) {
      classification = "ARCHIVED_MATCH";
      reasoning.push("Az egyetlen egyező Brand archivált.");
    } else if (externalBrand) {
      classification = "EXTERNAL_MAPPING_MATCH";
      matched = externalBrand;
      reasoning.push("Meglévő UNAS ExternalReference egyezés.");
    } else if (canonical.length === 1) {
      classification = "EXACT_CANONICAL_MATCH";
      reasoning.push("Normalizált kanonikus névegyezés.");
    } else if (alias.length === 1) {
      classification = "ALIAS_MATCH";
      reasoning.push("Aktív UNAS vagy manuális alias egyezés.");
    } else if (plausible.length > 1) {
      classification = "AMBIGUOUS";
      matched = undefined;
      reasoning.push(
        "Több aktív Brand osztozik jelentős névelemen; kézi választás szükséges.",
      );
    } else {
      classification = "MISSING_BRAND";
      matched = undefined;
      reasoning.push("Nem található biztonságos master-data egyezés.");
    }
    const sourceValue = group.values[0]!;
    const updated = Math.max(
      batch.updatedAt.getTime(),
      ...matches.map((brand) => new Date(brand.updatedAt).getTime()),
      external?.updatedAt.getTime() ?? 0,
    );
    return {
      id: rowId(normalized),
      sourceValue,
      normalizedSourceValue: normalized,
      occurrenceCount: group.examples.length,
      examples: group.examples.slice(0, 3),
      remainingExampleCount: Math.max(0, group.examples.length - 3),
      classification,
      proposedCanonicalName: sourceValue,
      matchedBrand: matched,
      matchedAlias: matched?.aliases.find(
        (item) => item.normalizedAlias === normalized,
      )?.alias,
      externalMapping: external
        ? {
            id: external.id,
            externalId: external.externalId,
            externalKey: external.externalKey ?? undefined,
          }
        : undefined,
      candidates: matches.length ? matches : plausible,
      conflictReason: classification === "CONFLICT" ? reasoning[0] : undefined,
      reasoning,
      resolverVersion: BRAND_RESOLUTION_VERSIONS.resolver,
      configVersion: batch.analysisVersion,
      updatedAt: new Date(updated).toISOString(),
    };
  }

  private async brandSummary(
    brand: any,
    mappings: any[],
  ): Promise<BrandSummary> {
    return {
      id: brand.id,
      name: brand.name,
      normalizedName: brand.normalizedName,
      slug: brand.slug,
      isActive: brand.isActive,
      archivedAt: brand.archivedAt?.toISOString(),
      aliases: brand.aliases.map((alias: any) => ({
        ...alias,
        sourceExternalId: alias.sourceExternalId ?? undefined,
        createdAt: alias.createdAt.toISOString(),
        updatedAt: alias.updatedAt.toISOString(),
      })),
      externalMappings: mappings
        .filter((mapping) => mapping.entityId === brand.id)
        .map((mapping) => ({
          id: mapping.id,
          system: mapping.system,
          externalId: mapping.externalId,
          externalKey: mapping.externalKey ?? undefined,
        })),
      usage: { productCount: brand._count.products, reviewReferenceCount: 0 },
      createdAt: brand.createdAt.toISOString(),
      updatedAt: brand.updatedAt.toISOString(),
    };
  }
  private async currentRow(batchId: string, id: string, expected: string) {
    const row = (await this.analyze(batchId)).rows.find(
      (item) => item.id === id,
    );
    if (!row) throw new NotFoundException("Az asszisztens sor nem található.");
    if (row.updatedAt !== expected)
      throw new ConflictException(
        "Az asszisztens állapota időközben megváltozott.",
      );
    return row;
  }
  private async assertMutableBatch(batchId: string) {
    const batch = await prisma.catalogImportBatch.findUnique({
      where: { id: batchId },
      select: { provider: true, status: true },
    });
    if (!batch || batch.provider !== "UNAS")
      throw new NotFoundException("Az UNAS import batch nem található.");
    if (!["VALIDATED", "APPROVED"].includes(batch.status))
      throw new ConflictException(
        "Ebben a batch státuszban a master-data nem módosítható.",
      );
  }
  private async reclassified(batchId: string, id: string) {
    return (await this.analyze(batchId)).rows.find((row) => row.id === id)!;
  }
  private async assertIdentityFree(
    tx: Prisma.TransactionClient,
    normalized: string,
    allowedBrandId?: string,
  ) {
    const [brand, alias] = await Promise.all([
      tx.brand.findUnique({ where: { normalizedName: normalized } }),
      tx.brandAlias.findUnique({ where: { normalizedAlias: normalized } }),
    ]);
    if (
      (brand && brand.id !== allowedBrandId) ||
      (alias && alias.brandId !== allowedBrandId)
    )
      throw new Error("IDENTITY_CONFLICT");
  }
  private map(error: unknown): never {
    if (
      error instanceof Error &&
      ["IDENTITY_CONFLICT", "MAPPING_CONFLICT"].includes(error.message)
    )
      throw new ConflictException(
        "A forrásérték vagy külső mapping már másik Brand tulajdona.",
      );
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    )
      throw new ConflictException(
        "A márkanév, alias vagy mapping időközben foglalttá vált.",
      );
    throw error;
  }
}
