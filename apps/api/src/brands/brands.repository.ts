import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { Prisma, Repository, prisma } from "@acropora/database";
import type { BrandDetail, BrandListResponse } from "@acropora/types";

import type {
  BrandAliasDto,
  BrandListQueryDto,
  CreateBrandDto,
  UpdateBrandDto,
} from "./dto/brand.dto.js";

const include: Prisma.BrandInclude = {
  aliases: { orderBy: [{ source: "asc" }, { alias: "asc" }] },
  _count: { select: { products: true } },
};
const normalize = (value: string) =>
  value
    .replace(/&/g, " and ")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
const slugify = (value: string) => normalize(value).replace(/ /g, "-");

@Injectable()
export class BrandsRepository extends Repository {
  constructor() {
    super(prisma);
  }

  async list(query: BrandListQueryDto): Promise<BrandListResponse> {
    const where: Prisma.BrandWhereInput = {
      ...(query.status === "ALL"
        ? {}
        : { isActive: query.status === "ACTIVE" }),
      ...(query.source ? { aliases: { some: { source: query.source } } } : {}),
      ...(query.hasProducts === undefined
        ? {}
        : { products: query.hasProducts ? { some: {} } : { none: {} } }),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: "insensitive" } },
              { slug: { contains: query.search, mode: "insensitive" } },
              {
                aliases: {
                  some: {
                    alias: { contains: query.search, mode: "insensitive" },
                  },
                },
              },
            ],
          }
        : {}),
    };
    const [brands, totalItems] = await Promise.all([
      prisma.brand.findMany({
        where,
        include,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.brand.count({ where }),
    ]);
    const items = await Promise.all(
      brands.map((brand) => this.toDetail(brand)),
    );
    return {
      items,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / query.pageSize),
      },
    };
  }

  async detail(id: string): Promise<BrandDetail | null> {
    const brand = await prisma.brand.findUnique({ where: { id }, include });
    return brand ? this.toDetail(brand) : null;
  }

  create(input: CreateBrandDto, actorId: string) {
    const name = input.name.trim();
    const normalizedName = normalize(name);
    return prisma.$transaction(
      async (tx) => {
        if (
          await tx.brandAlias.findFirst({
            where: { normalizedAlias: normalizedName },
          })
        )
          throw new Error("IDENTITY_CONFLICT");
        const aliases = input.aliases.filter(
          (alias) => normalize(alias.alias) !== normalizedName,
        );
        const brand = await tx.brand.create({
          data: {
            name,
            normalizedName,
            slug: slugify(name),
            description: input.description?.trim(),
            websiteUrl: input.websiteUrl,
            logoUrl: input.logoUrl,
            aliases: {
              create: aliases.map((alias) => ({
                alias: alias.alias.trim(),
                normalizedAlias: normalize(alias.alias),
                source: alias.source.toUpperCase(),
                sourceExternalId: alias.sourceExternalId,
                isPreferred: alias.isPreferred,
              })),
            },
          },
          include,
        });
        if (input.unasExternalId)
          await tx.externalReference.create({
            data: {
              system: "UNAS",
              entityType: "BRAND",
              entityId: brand.id,
              externalId: input.unasExternalId,
              externalKey: name,
            },
          });
        await this.event(tx, "brand.created", brand.id, actorId, { name });
        return this.toDetail(brand, tx);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  update(id: string, input: UpdateBrandDto, actorId: string) {
    return prisma.$transaction(
      async (tx) => {
        const existing = await tx.brand.findUniqueOrThrow({ where: { id } });
        const name = input.name?.trim();
        if (
          name &&
          (await tx.brandAlias.findFirst({
            where: {
              normalizedAlias: normalize(name),
              brandId: { not: id },
            },
          }))
        )
          throw new Error("IDENTITY_CONFLICT");
        const changed = await tx.brand.updateMany({
          where: { id, updatedAt: new Date(input.expectedUpdatedAt) },
          data: {
            ...(name
              ? { name, normalizedName: normalize(name), slug: slugify(name) }
              : {}),
            description: input.description,
            websiteUrl: input.websiteUrl,
            logoUrl: input.logoUrl,
          },
        });
        if (changed.count !== 1) throw new Error("STALE_UPDATE");
        await this.event(tx, "brand.updated", id, actorId, {
          previousName: existing.name,
          name: name ?? existing.name,
        });
        const brand = await tx.brand.findUniqueOrThrow({
          where: { id },
          include,
        });
        return this.toDetail(brand, tx);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  setArchived(id: string, archived: boolean, actorId: string) {
    return prisma.$transaction(
      async (tx) => {
        const brand = await tx.brand.update({
          where: { id },
          data: {
            isActive: !archived,
            archivedAt: archived ? new Date() : null,
          },
          include,
        });
        await this.event(
          tx,
          archived ? "brand.archived" : "brand.restored",
          id,
          actorId,
          { name: brand.name },
        );
        return this.toDetail(brand, tx);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  addAlias(brandId: string, input: BrandAliasDto, actorId: string) {
    return prisma.$transaction(
      async (tx) => {
        const brand = await tx.brand.findUniqueOrThrow({
          where: { id: brandId },
        });
        const normalizedAlias = normalize(input.alias);
        if (normalizedAlias === brand.normalizedName)
          throw new Error("CANONICAL_ALIAS");
        if (
          await tx.brand.findFirst({
            where: { normalizedName: normalizedAlias, id: { not: brandId } },
          })
        )
          throw new Error("IDENTITY_CONFLICT");
        await tx.brandAlias.create({
          data: {
            brandId,
            alias: input.alias.trim(),
            normalizedAlias,
            source: input.source.toUpperCase(),
            sourceExternalId: input.sourceExternalId,
            isPreferred: input.isPreferred,
          },
        });
        await this.event(tx, "brand.alias-added", brandId, actorId, {
          alias: input.alias,
          source: input.source,
        });
        const result = await tx.brand.findUniqueOrThrow({
          where: { id: brandId },
          include,
        });
        return this.toDetail(result, tx);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async updateAlias(
    brandId: string,
    aliasId: string,
    input: BrandAliasDto,
    actorId: string,
  ) {
    return prisma.$transaction(
      async (tx) => {
        const alias = await tx.brandAlias.findFirstOrThrow({
          where: { id: aliasId, brandId },
        });
        if (
          input.expectedUpdatedAt &&
          alias.updatedAt.getTime() !==
            new Date(input.expectedUpdatedAt).getTime()
        )
          throw new Error("STALE_UPDATE");
        const normalizedAlias = normalize(input.alias);
        if (
          await tx.brand.findFirst({
            where: { normalizedName: normalizedAlias, id: { not: brandId } },
          })
        )
          throw new Error("IDENTITY_CONFLICT");
        await tx.brandAlias.update({
          where: { id: aliasId },
          data: {
            alias: input.alias.trim(),
            normalizedAlias,
            source: input.source.toUpperCase(),
            sourceExternalId: input.sourceExternalId,
            isPreferred: input.isPreferred,
          },
        });
        await this.event(tx, "brand.alias-updated", brandId, actorId, {
          alias: input.alias,
        });
        const brand = await tx.brand.findUniqueOrThrow({
          where: { id: brandId },
          include,
        });
        return this.toDetail(brand, tx);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  removeAlias(brandId: string, aliasId: string, actorId: string) {
    return prisma.$transaction(
      async (tx) => {
        const alias = await tx.brandAlias.findFirstOrThrow({
          where: { id: aliasId, brandId },
        });
        await tx.brandAlias.delete({ where: { id: aliasId } });
        await this.event(tx, "brand.alias-removed", brandId, actorId, {
          alias: alias.alias,
        });
        const brand = await tx.brand.findUniqueOrThrow({
          where: { id: brandId },
          include,
        });
        return this.toDetail(brand, tx);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async toDetail(
    brand: any,
    client: any = prisma,
  ): Promise<BrandDetail> {
    const [mappings, reviewReferenceCount] = await Promise.all([
      client.externalReference.findMany({
        where: { entityType: "BRAND", entityId: brand.id },
        orderBy: [{ system: "asc" }, { externalId: "asc" }],
      }),
      client.brandResolutionReview.count({
        where: {
          OR: [
            { proposedBrandKey: brand.normalizedName },
            { resolvedBrandKey: brand.normalizedName },
          ],
        },
      }),
    ]);
    return {
      id: brand.id,
      name: brand.name,
      normalizedName: brand.normalizedName,
      slug: brand.slug,
      description: brand.description ?? undefined,
      websiteUrl: brand.websiteUrl ?? undefined,
      logoUrl: brand.logoUrl ?? undefined,
      isActive: brand.isActive,
      archivedAt: brand.archivedAt?.toISOString(),
      metadata: brand.metadata ?? undefined,
      aliases: brand.aliases.map((alias: any) => ({
        ...alias,
        sourceExternalId: alias.sourceExternalId ?? undefined,
        createdAt: alias.createdAt.toISOString(),
        updatedAt: alias.updatedAt.toISOString(),
      })),
      externalMappings: mappings.map((mapping: any) => ({
        id: mapping.id,
        system: mapping.system,
        externalId: mapping.externalId,
        externalKey: mapping.externalKey ?? undefined,
      })),
      usage: { productCount: brand._count.products, reviewReferenceCount },
      createdAt: brand.createdAt.toISOString(),
      updatedAt: brand.updatedAt.toISOString(),
    };
  }

  private event(
    tx: Prisma.TransactionClient,
    eventType: string,
    aggregateId: string,
    actorUserId: string,
    payload: Prisma.JsonObject,
  ) {
    return tx.domainEvent.create({
      data: {
        id: randomUUID(),
        eventType,
        aggregateType: "Brand",
        aggregateId,
        actorUserId,
        payload,
        occurredAt: new Date(),
        schemaVersion: 1,
      },
    });
  }
}

export { normalize as normalizeBrandName };
