import { randomUUID } from "node:crypto";

import { Inject, Injectable, Optional } from "@nestjs/common";
import { Prisma, Repository, prisma } from "@acropora/database";

import type { CreateProductDto } from "./dto/create-product.dto.js";
import type { ProductListQueryDto } from "./dto/product-list-query.dto.js";
import type { UpdateProductDto } from "./dto/update-product.dto.js";
import type {
  ProductListResult,
  ProductWithRelations,
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
  variants: true,
  channelListings: { orderBy: { channel: "asc" } },
  images: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
} as const;

interface ProductTransaction {
  product: {
    create(args: unknown): Promise<ProductWithRelations>;
    findUnique(args: unknown): Promise<ProductWithRelations | null>;
    update(args: unknown): Promise<ProductWithRelations>;
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
  ): Promise<ProductWithRelations> {
    const primaryCategoryId = input.primaryCategoryId ?? input.categoryId;
    return this.productDatabase.$transaction(
      async (transaction) => {
        const product = await transaction.product.create({
          data: {
            name: input.name,
            description: input.description,
            type: input.productType,
            brandId: input.brandId,
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
            } satisfies Prisma.JsonObject,
          },
        });

        return product;
      },
      { isolationLevel: "Serializable" },
    );
  }

  findById(id: string): Promise<ProductWithRelations | null> {
    return this.productDatabase.product.findUnique({
      where: { id },
      include: productInclude,
    });
  }

  async list(query: ProductListQueryDto): Promise<ProductListResult> {
    const where: Prisma.ProductWhereInput = {
      ...(query.active === undefined ? {} : { isActive: query.active }),
      ...(query.brandId ? { brandId: query.brandId } : {}),
      ...(query.categoryId
        ? { categories: { some: { categoryId: query.categoryId } } }
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
        include: productInclude,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        skip,
        take: query.pageSize,
      }),
      this.productDatabase.product.count({ where }),
    ]);

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

  update(id: string, input: UpdateProductDto): Promise<ProductWithRelations> {
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
        return product;
      },
      { isolationLevel: "Serializable" },
    );
  }

  archive(id: string): Promise<ProductWithRelations> {
    return this.productDatabase.product.update({
      where: { id },
      data: { isActive: false, archivedAt: new Date() },
      include: productInclude,
    });
  }
}
