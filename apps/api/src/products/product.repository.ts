import { randomUUID } from "node:crypto";

import { Inject, Injectable, Optional } from "@nestjs/common";
import { Prisma, Repository, prisma } from "@acropora/database";
import type {
  CatalogOption,
  ProductDetail,
  ProductListResponse,
} from "@acropora/types";

import type { CreateProductDto } from "./dto/create-product.dto.js";
import type { ProductListQueryDto } from "./dto/product-list-query.dto.js";
import type { UpdateProductDto } from "./dto/update-product.dto.js";
import {
  toProductDetail,
  toProductListItem,
  type ProductWithRelations,
} from "./product.types.js";

const productInclude = {
  brand: true,
  categories: {
    include: { category: true },
    orderBy: [
      { isPrimary: "desc" },
      { sortOrder: "asc" },
      { createdAt: "asc" },
    ],
  },
  variants: {
    include: {
      extension: true,
      stockItems: true,
      // Primary first, then stable by code so the detail response and the
      // barcode editor never disagree about ordering.
      barcodes: { orderBy: [{ isPrimary: "desc" }, { code: "asc" }] },
    },
  },
  channelListings: { orderBy: { channel: "asc" } },
  images: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
  unasSnapshot: true,
} as const;

const productListInclude = {
  brand: true,
  categories: {
    where: { isPrimary: true },
    include: { category: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    take: 1,
  },
  variants: {
    where: { isActive: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: { stockItems: true },
  },
  channelListings: {
    where: { channel: "UNAS" },
    orderBy: { createdAt: "asc" },
    take: 1,
  },
  images: {
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    take: 1,
  },
  unasSnapshot: {
    select: {
      grossPrice: true,
      saleGrossPrice: true,
      isPackageProduct: true,
    },
  },
} as const;

interface ProductTransaction {
  product: {
    create(args: unknown): Promise<ProductWithRelations>;
    findUnique(args: unknown): Promise<ProductWithRelations | null>;
    update(args: unknown): Promise<ProductWithRelations>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  productCategory: {
    updateMany(args: unknown): Promise<unknown>;
    upsert(args: unknown): Promise<unknown>;
  };
  domainEvent: {
    create(args: unknown): Promise<unknown>;
  };
}

export interface ProductDatabase {
  product: {
    findUnique(args: unknown): Promise<ProductWithRelations | null>;
    findMany(args: unknown): Promise<ProductWithRelations[]>;
    count(args: unknown): Promise<number>;
    update(args: unknown): Promise<ProductWithRelations>;
  };
  category: {
    findMany(
      args: unknown,
    ): Promise<Array<{ id: string; name: string; parentId: string | null }>>;
  };
  brand: {
    findMany(args: unknown): Promise<Array<{ id: string; name: string }>>;
  };
  externalReference: {
    findFirst(args: unknown): Promise<{ externalId: string } | null>;
  };
  $transaction<T>(
    operation: (transaction: ProductTransaction) => Promise<T>,
    options?: { isolationLevel: "Serializable" },
  ): Promise<T>;
}

export const PRODUCT_DATABASE = Symbol("PRODUCT_DATABASE");

@Injectable()
export class ProductRepository extends Repository {
  private readonly productDatabase: ProductDatabase;

  constructor(
    @Optional()
    @Inject(PRODUCT_DATABASE)
    productDatabase?: ProductDatabase,
  ) {
    super(prisma);
    this.productDatabase =
      productDatabase ?? (prisma as unknown as ProductDatabase);
  }

  async create(
    input: CreateProductDto,
    actorUserId?: string,
  ): Promise<ProductDetail> {
    const primaryCategoryId = input.primaryCategoryId ?? input.categoryId;
    return this.productDatabase.$transaction(
      async (transaction) => {
        const product = await transaction.product.create({
          data: {
            name: input.name,
            description: input.description,
            type: input.productType,
            brandId: input.brandId,
            origin: "LOCAL",
            catalogAuthority: "ACROPORA",
            createdById: actorUserId,
            categoryId: primaryCategoryId,
            ...(primaryCategoryId
              ? {
                  categories: {
                    create: {
                      categoryId: primaryCategoryId,
                      isPrimary: true,
                      source: "MANUAL",
                    },
                  },
                }
              : {}),
          },
          include: productInclude,
        });

        await transaction.domainEvent.create({
          data: {
            id: randomUUID(),
            eventType: "product.created",
            aggregateType: "Product",
            aggregateId: product.id,
            actorUserId,
            occurredAt: new Date(),
            schemaVersion: 1,
            payload: {
              name: product.name,
              productType: product.type,
              origin: product.origin,
              catalogAuthority: product.catalogAuthority,
            } satisfies Prisma.JsonObject,
          },
        });

        return toProductDetail(product);
      },
      { isolationLevel: "Serializable" },
    );
  }

  async findById(id: string): Promise<ProductDetail | null> {
    const [product, externalReference] = await Promise.all([
      this.productDatabase.product.findUnique({
        where: { id },
        include: productInclude,
      }),
      this.productDatabase.externalReference.findFirst({
        where: { system: "UNAS", entityType: "Product", entityId: id },
        select: { externalId: true },
      }),
    ]);
    return product
      ? toProductDetail(product, externalReference?.externalId ?? null)
      : null;
  }

  async list(query: ProductListQueryDto): Promise<ProductListResponse> {
    const where: Prisma.ProductWhereInput = {
      ...(query.active === undefined ? {} : { isActive: query.active }),
      ...(query.brandId ? { brandId: query.brandId } : {}),
      ...(query.categoryId
        ? { categories: { some: { categoryId: query.categoryId } } }
        : {}),
      // A listing row is the record that the product is carried on that
      // channel. `isPublished` deliberately has no part in this: no writer
      // sets it, so it is false on every row, and asking for published
      // products would answer with an empty shop.
      ...(query.listedOn
        ? { channelListings: { some: { channel: query.listedOn } } }
        : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: "insensitive" } },
              {
                variants: {
                  some: {
                    sku: { contains: query.search, mode: "insensitive" },
                  },
                },
              },
            ],
          }
        : {}),
    };
    const skip = (query.page - 1) * query.pageSize;
    const [items, totalItems] = await Promise.all([
      this.productDatabase.product.findMany({
        where,
        include: productListInclude,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        skip,
        take: query.pageSize,
      }),
      this.productDatabase.product.count({ where }),
    ]);

    return {
      items: items.map(toProductListItem),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / query.pageSize),
      },
    };
  }

  update(id: string, input: UpdateProductDto): Promise<ProductDetail> {
    const primaryCategoryId =
      input.primaryCategoryId !== undefined
        ? input.primaryCategoryId
        : input.categoryId;
    const primaryWasProvided =
      input.primaryCategoryId !== undefined || input.categoryId !== undefined;

    return this.productDatabase.$transaction(
      async (transaction) => {
        await transaction.product.update({
          where: { id },
          data: {
            name: input.name,
            description: input.description,
            type: input.productType,
            brandId: input.brandId,
            ...(primaryWasProvided ? { categoryId: primaryCategoryId } : {}),
          },
          include: productInclude,
        });

        if (primaryWasProvided) {
          await transaction.productCategory.updateMany({
            where: { productId: id, isPrimary: true },
            data: { isPrimary: false },
          });

          if (primaryCategoryId) {
            await transaction.productCategory.upsert({
              where: {
                productId_categoryId: {
                  productId: id,
                  categoryId: primaryCategoryId,
                },
              },
              update: { isPrimary: true, source: "MANUAL" },
              create: {
                productId: id,
                categoryId: primaryCategoryId,
                isPrimary: true,
                source: "MANUAL",
              },
            });
          }
        }

        const product = await transaction.product.findUnique({
          where: { id },
          include: productInclude,
        });

        if (!product) throw new Error("A frissített termék nem található.");
        return toProductDetail(product);
      },
      { isolationLevel: "Serializable" },
    );
  }

  async archive(id: string): Promise<ProductDetail> {
    const product = await this.productDatabase.product.update({
      where: { id },
      data: { isActive: false, archivedAt: new Date() },
      include: productInclude,
    });
    return toProductDetail(product);
  }

  /**
   * Átveszi a termék törzsadat-gazdaságát a UNAS-tól.
   *
   * A váltás FELTÉTELES egyetlen `updateMany` hívásban, és ez nem stílus: két
   * párhuzamos átvétel közül így pontosan az egyik ír, a másik nulla sort
   * érint. Ha előbb olvasnánk és utána írnánk, mindkettő azt hinné, hogy ő
   * váltott, és két esemény kerülne a naplóba ugyanarról az egy váltásról.
   *
   * A visszatérés `changed` mezője azt mondja meg, hogy TÖRTÉNT-E a váltás,
   * nem azt, hogy sikerült-e a hívás. Egy megismételt átvétel nem hiba: a
   * termék attól még a miénk. Esemény viszont csak a VALÓDI váltáskor
   * keletkezik, különben a napló ugyanazt az egy döntést többször mondaná el.
   */
  async takeCatalogAuthority(
    id: string,
    actorUserId?: string,
  ): Promise<{ product: ProductDetail; changed: boolean }> {
    return this.productDatabase.$transaction(
      async (transaction) => {
        const result = await transaction.product.updateMany({
          where: { id, catalogAuthority: "UNAS" },
          data: { catalogAuthority: "ACROPORA" },
        });

        if (result.count > 0)
          await transaction.domainEvent.create({
            data: {
              id: randomUUID(),
              eventType: "product.catalog-authority.transferred",
              aggregateType: "Product",
              aggregateId: id,
              actorUserId,
              occurredAt: new Date(),
              schemaVersion: 1,
              payload: {
                from: "UNAS",
                to: "ACROPORA",
              } satisfies Prisma.JsonObject,
            },
          });

        const product = await transaction.product.findUnique({
          where: { id },
          include: productInclude,
        });

        if (!product) throw new Error("Az átvett termék nem található.");
        return { product: toProductDetail(product), changed: result.count > 0 };
      },
      { isolationLevel: "Serializable" },
    );
  }

  async listCategoryOptions(): Promise<CatalogOption[]> {
    const categories = await this.productDatabase.category.findMany({
      select: { id: true, name: true, parentId: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    const byId = new Map(categories.map((category) => [category.id, category]));

    const labelFor = (category: (typeof categories)[number]) => {
      const labels = [category.name];
      const visited = new Set([category.id]);
      let parentId = category.parentId;
      while (parentId && !visited.has(parentId)) {
        visited.add(parentId);
        const parent = byId.get(parentId);
        if (!parent) break;
        labels.unshift(parent.name);
        parentId = parent.parentId;
      }
      return labels.join(" / ");
    };

    return categories
      .map((category) => ({ id: category.id, label: labelFor(category) }))
      .sort((left, right) =>
        left.label.localeCompare(right.label, "hu", { sensitivity: "base" }),
      );
  }

  async listBrandOptions(): Promise<CatalogOption[]> {
    const brands = await this.productDatabase.brand.findMany({
      select: { id: true, name: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    return brands.map((brand) => ({ id: brand.id, label: brand.name }));
  }
}
