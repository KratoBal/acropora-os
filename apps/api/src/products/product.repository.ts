import { randomUUID } from "node:crypto";

import { Inject, Injectable, Optional } from "@nestjs/common";
import { Prisma, Repository, prisma } from "@acropora/database";
import type {
  CatalogOption,
  ProductDetail,
  ProductListResponse,
} from "@acropora/types";

import { writeSearchDocument } from "../integrations/ai-product-search/ai-product-search.writer.js";
import {
  takeoverPriceLog,
  takeoverPriceSteps,
  type TakeoverPriceMirror,
  type TakeoverPriceVariant,
} from "./takeover-price.js";
import { recordOwnPrice } from "./price-history/own-price-history.js";
import type { ArKep } from "../imports/unas/unas-ar-tortenet.js";
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
  datasheet: {
    select: { fenyIgeny: true, aramlasIgeny: true },
  },
} as const;

const productListInclude = {
  brand: true,
  categories: {
    where: { isPrimary: true },
    // the leaf and three ancestors: the list's image fallback reads the
    // category group from the path (`categoryPath`)
    include: {
      category: {
        include: {
          parent: { include: { parent: { include: { parent: true } } } },
        },
      },
    },
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
  /** A gazda-átvétel ármásolásához (fc5fb5f9): a tükör ára és a változatok. */
  unasProductSnapshot: {
    findUnique(args: unknown): Promise<TakeoverPriceMirror>;
  };
  productVariant: {
    findMany(args: unknown): Promise<TakeoverPriceVariant[]>;
    /** az ár-szerkesztő előtte-képéhez (T4.1-D3) */
    findFirst(args: unknown): Promise<{
      sellingGrossPrice: Prisma.Decimal | null;
      sellingPriceCurrency: string | null;
    } | null>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  /** A másolt saját ár előzményének kezdő sora (T4.1-D2), ugyanabban a tranzakcióban. */
  productPriceHistory: {
    findFirst(args: unknown): Promise<ArKep | null>;
    create(args: unknown): Promise<unknown>;
  };
  /**
   * A keresési dokumentum írója ezt az egy táblát használja a hívó
   * tranzakciójából. Azért van kiírva ebben a szűk felületben is, mert a
   * dokumentumnak ugyanabban a tranzakcióban kell készülnie, mint a
   * terméknek - lásd `writeSearchDocument`.
   */
  aiProductSearchDocument: {
    upsert(args: unknown): Promise<unknown>;
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

        await writeSearchDocument(transaction, product.id);

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
    const placementNeedsWereProvided =
      input.fenyIgeny !== undefined || input.aramlasIgeny !== undefined;

    return this.productDatabase.$transaction(
      async (transaction) => {
        await transaction.product.update({
          where: { id },
          data: {
            name: input.name,
            description: input.description,
            type: input.productType,
            brandId: input.brandId,
            webshopSellable: input.webshopSellable,
            advisorKind: input.advisorKind,
            ...(placementNeedsWereProvided
              ? {
                  datasheet: {
                    upsert: {
                      create: {
                        ...(input.fenyIgeny !== undefined
                          ? { fenyIgeny: input.fenyIgeny }
                          : {}),
                        ...(input.aramlasIgeny !== undefined
                          ? { aramlasIgeny: input.aramlasIgeny }
                          : {}),
                      },
                      update: {
                        ...(input.fenyIgeny !== undefined
                          ? { fenyIgeny: input.fenyIgeny }
                          : {}),
                        ...(input.aramlasIgeny !== undefined
                          ? { aramlasIgeny: input.aramlasIgeny }
                          : {}),
                      },
                    },
                  },
                }
              : {}),
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

        await writeSearchDocument(transaction, id);

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

  /**
   * A LEVÉTEL TRANZAKCIÓBAN FUT, ÉS EZ NEM ÓVATOSSÁG.
   *
   * Az `isActive` az egyik olyan mező, amit a keresési dokumentum
   * `isSearchable` jelzője ÁTVESZ, és amit az egyensúly-ellenőrzés a másik
   * oldalon számol. Ha a levétel a termékre lefutna, a dokumentumra pedig nem,
   * a két szám minden egyes archiválás után eltérne - vagyis az az ellenőrzés,
   * ami a néma hibát keresi, maga válna zajossá, és két hét múlva senki nem
   * nézné meg. A két írásnak együtt kell megtörténnie vagy sehogy.
   */
  async archive(id: string): Promise<ProductDetail> {
    return this.productDatabase.$transaction(async (transaction) => {
      const product = await transaction.product.update({
        where: { id },
        data: { isActive: false, archivedAt: new Date() },
        include: productInclude,
      });
      await writeSearchDocument(transaction, id);
      return toProductDetail(product);
    });
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

        /*
          AZ ÁR AZ ÁTVÉTELLEL EGYÜTT (fc5fb5f9, lásd `takeover-price.ts`): csak
          a VALÓDI váltáskor, és változatonként feltételesen (`sellingGrossPrice:
          null`), hogy egy közben beírt saját árat se írjunk felül.
        */
        let priceSeed: Prisma.JsonObject | null = null;
        if (result.count > 0) {
          const [mirror, variants] = await Promise.all([
            transaction.unasProductSnapshot.findUnique({
              where: { productId: id },
              select: { grossPrice: true, currency: true },
            }),
            transaction.productVariant.findMany({
              where: { productId: id },
              select: {
                id: true,
                sku: true,
                sellingGrossPrice: true,
                unasVariantExtraGrossPrice: true,
              },
              orderBy: { sku: "asc" },
            }),
          ]);
          const steps = takeoverPriceSteps(variants, mirror);
          const takenAt = new Date();
          for (const step of steps)
            if (step.kind === "copy") {
              const copied = await transaction.productVariant.updateMany({
                where: { id: step.variantId, sellingGrossPrice: null },
                data: {
                  sellingGrossPrice: step.sellingGrossPrice,
                  sellingPriceCurrency: step.sellingPriceCurrency,
                },
              });
              // the copy is the variant's FIRST own price: its history starts here, in the same
              // transaction (`own-price-history.ts`); a variant that got a price in the
              // meantime (count 0) was not copied, so it gets no row from this step
              if (copied.count > 0)
                await recordOwnPrice(transaction, {
                  productId: id,
                  variantId: step.variantId,
                  currency: step.sellingPriceCurrency,
                  grossPrice: step.sellingGrossPrice,
                  observedAt: takenAt,
                });
            }
          priceSeed = takeoverPriceLog(steps);
        }

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
                ...(priceSeed ? { priceSeed } : {}),
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

  /**
   * A VÁLTOZAT SAJÁT ÁRÁNAK SZERKESZTÉSE (T4.1-D3, 2. szelet). Egy tranzakció:
   *
   * - az ár a változatra, CSAK ha az a termékhez tartozik (`productId` a
   *   where ágban, tehát egy idegen változat-azonosító nem ír semmit);
   * - az előzmény ugyanabban a tranzakcióban (`recordOwnPrice`, a D2 szabálya:
   *   aki a `sellingGrossPrice`-t írja, az írja az előzményt is; csak változáskor
   *   keletkezik sor);
   * - a termék `updatedAt`-je is lép, mert a Medusa-vetítés esedékességét a
   *   termék-sor ideje adja: enélkül az új ár a termék következő, más okú
   *   változásáig nem menne ki;
   * - esemény a régi és az új árral, a végzővel.
   *
   * A pénznem a változat eddigi pénzneme, ennek hiányában forint (a tükör sem
   * hordoz mást, lásd `takeover-price.ts`). `null`: a változat nem ehhez a
   * termékhez tartozik.
   */
  async setVariantSellingPrice(
    productId: string,
    variantId: string,
    grossPrice: Prisma.Decimal,
    actorUserId?: string,
  ): Promise<ProductDetail | null> {
    return this.productDatabase.$transaction(
      async (transaction) => {
        const before = await transaction.productVariant.findFirst({
          where: { id: variantId, productId },
          select: { sellingGrossPrice: true, sellingPriceCurrency: true },
        });
        if (!before) return null;
        const currency = before.sellingPriceCurrency ?? "HUF";
        await transaction.productVariant.updateMany({
          where: { id: variantId, productId },
          data: {
            sellingGrossPrice: grossPrice,
            sellingPriceCurrency: currency,
          },
        });
        const now = new Date();
        const history = await recordOwnPrice(transaction, {
          productId,
          variantId,
          currency,
          grossPrice,
          observedAt: now,
        });
        await transaction.product.update({
          where: { id: productId },
          data: { updatedAt: now },
        });
        await transaction.domainEvent.create({
          data: {
            id: randomUUID(),
            eventType: "product.variant.selling-price.set",
            aggregateType: "Product",
            aggregateId: productId,
            actorUserId,
            occurredAt: now,
            schemaVersion: 1,
            payload: {
              variantId,
              from: before.sellingGrossPrice?.toString() ?? null,
              to: grossPrice.toString(),
              currency,
              history,
            } satisfies Prisma.JsonObject,
          },
        });
        const product = await transaction.product.findUnique({
          where: { id: productId },
          include: productInclude,
        });
        if (!product) throw new Error("A termék nem található.");
        return toProductDetail(product);
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
