import { randomUUID } from "node:crypto";

import { Inject, Injectable, Optional } from "@nestjs/common";
import { Prisma, Repository, prisma } from "@acropora/database";
import type {
  CatalogOption,
  ProductDetail,
  ProductListResponse,
  ShippingFilterValue,
} from "@acropora/types";

import { writeSearchDocument } from "../integrations/ai-product-search/ai-product-search.writer.js";
import {
  takeoverPriceLog,
  takeoverPriceSteps,
  type TakeoverPriceMirror,
  type TakeoverPriceVariant,
} from "./takeover-price.js";
import { recordOwnPrice } from "./price-history/own-price-history.js";
import { isOwnSaleActive } from "./own-sale.js";
import {
  datasheetPatchOf,
  filledNameFields,
} from "./product-datasheet-patch.js";
import { retryOnSerializationConflict } from "../common/transaction-retry.util.js";
import { unasShippingProfile } from "../integrations/medusa/medusa-unas-shipping.policy.js";
import {
  manualFlagsDifferingFromUnas,
  pinUnasShippingFlags,
  SHIPPING_FLAGS,
  type ShippingFlag,
  type ShippingFlagSource,
  type StoredShippingProfile,
} from "./shipping-profile-sources.js";
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
  shippingProfile: {
    select: {
      pickupOnly: true,
      foxpostForbidden: true,
      isHeavy: true,
      isFrozen: true,
      lockerUnsuitable: true,
    },
  },
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
    select: {
      fenyIgeny: true,
      aramlasIgeny: true,
      magyarNev: true,
      angolNev: true,
      nemetNev: true,
    },
  },
} as const;

/**
 * THE LIST'S SHIPPING FILTER (a82ed229): one flag set on the product's shipping profile, or `none` for a product
 * nobody has looked at yet (it has no profile). Not set: no narrowing.
 */
export function shippingFilterWhere(
  filter: Exclude<ShippingFilterValue, "unasDiff"> | undefined,
): Prisma.ProductWhereInput {
  if (!filter) return {};
  if (filter === "none") return { shippingProfile: { is: null } };
  return { shippingProfile: { is: { [filter]: true } } };
}

const productListInclude = {
  brand: true,
  // the shipping flags for the list's column (a82ed229)
  shippingProfile: {
    select: {
      pickupOnly: true,
      foxpostForbidden: true,
      isHeavy: true,
      isFrozen: true,
      lockerUnsuitable: true,
    },
  },
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
  /** Egy kitoltott nev feloldja a mezo megtagadasat (kartya 20b0dd47): elobb a sor, aztan a torles. */
  productDatasheetFieldRefusal: {
    findMany(args: unknown): Promise<
      {
        mezo: string;
        indok: string;
        oka: string;
        createdAt: Date;
      }[]
    >;
    deleteMany(args: unknown): Promise<{ count: number }>;
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
    /** az ár- és az akció-szerkesztő előtte-képéhez (T4.1-D3) */
    findFirst(args: unknown): Promise<VariantPriceBefore | null>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  /** A képek alt-szövege és sorrendje (4. szelet), feltöltése és törlése (6. szelet). */
  productImage: {
    findMany(args: unknown): Promise<Array<{ id: string }>>;
    findFirst(args: unknown): Promise<StoredProductImage | null>;
    aggregate(args: unknown): Promise<{ _max: { sortOrder: number | null } }>;
    create(args: unknown): Promise<{ id: string }>;
    deleteMany(args: unknown): Promise<{ count: number }>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  /** A termék sorának zárolása a képlista-írásokhoz (`SELECT ... FOR UPDATE`). */
  $queryRaw(
    query: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown>;
  /** Átvételkor a UNAS-forrású szállítási jelzők kézire billennek (T4.1-D3). */
  productShippingProfile: {
    findUnique(
      args: unknown,
    ): Promise<Record<`${ShippingFlag}Source`, ShippingFlagSource> | null>;
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
  /** a feltöltött kép kiolvasásához (T4.1-D3, 6. szelet) */
  productImage: {
    findFirst(args: unknown): Promise<StoredProductImage | null>;
  };
  /** a lista eltérés-szűrőjéhez (a82ed229, 2d): a kézi jelzős sorok és a UNAS-adatuk */
  productShippingProfile: {
    findMany(
      args: unknown,
    ): Promise<Array<StoredShippingProfile & { productId: string }>>;
  };
  unasProductSnapshot: {
    findMany(
      args: unknown,
    ): Promise<Array<{ productId: string; rawPayload: unknown }>>;
  };
  $transaction<T>(
    operation: (transaction: ProductTransaction) => Promise<T>,
    options?: { isolationLevel?: "Serializable"; timeout?: number },
  ): Promise<T>;
}

export const PRODUCT_DATABASE = Symbol("PRODUCT_DATABASE");

/** A változat ár-képe írás előtt: a saját ár és a saját akció (T4.1-D3). */
export interface VariantPriceBefore {
  sellingGrossPrice: Prisma.Decimal | null;
  sellingPriceCurrency: string | null;
  sellingSaleGrossPrice: Prisma.Decimal | null;
  sellingSaleStartsAt: Date | null;
  sellingSaleEndsAt: Date | null;
}

const VARIANT_PRICE_BEFORE_SELECT = {
  sellingGrossPrice: true,
  sellingPriceCurrency: true,
  sellingSaleGrossPrice: true,
  sellingSaleStartsAt: true,
  sellingSaleEndsAt: true,
} as const;

/** A saját akció: ár és félig nyitott ablak (`[startsAt, endsAt)`). */
export interface VariantSale {
  grossPrice: Prisma.Decimal;
  startsAt: Date;
  endsAt: Date;
}

/**
 * AZ AKCIÓ ÉS A RENDES ÁR ÜTKÖZÉSE (T4.1-D3). Az akció csak a saját eladási árnál
 * olcsóbb lehet, különben a bolt hamis kedvezményt mutatna; ugyanez fordítva: a
 * rendes ár nem csökkenhet a beállított akció alá. A tranzakcióban dobjuk, tehát
 * semmi nem íródik; a szolgáltatás 409-re fordítja.
 */
export class VariantSaleConflict extends Error {
  constructor(
    readonly code: "own-price-missing" | "sale-not-lower" | "sale-start-locked",
    readonly sellingGrossPrice: string | null,
    readonly saleGrossPrice: string | null,
  ) {
    super(code);
  }
}

/** Egy kép sora, amennyi a fájljához kell. */
export interface StoredProductImage {
  id: string;
  url: string;
  storageKey: string | null;
  fileName: string | null;
}

const STORED_IMAGE_SELECT = {
  id: true,
  url: true,
  storageKey: true,
  fileName: true,
} as const;

/** Egy feltöltött kép, amit a tároló már őriz. */
export interface UploadedProductImage {
  url: string;
  storageKey: string;
  fileName: string;
}

/** A feltöltés tranzakciójának felső határa: a fájl-írás a termék zárja alatt fut. */
export const UPLOAD_TRANSACTION_TIMEOUT_MS = 30_000;

/** A felületről feltöltött kép forrása; a UNAS-írók csak a `UNAS` sorokat cserélik. */
export const UPLOADED_IMAGE_SOURCE = "OS";

function saleImage(before: VariantPriceBefore): Prisma.JsonObject | null {
  if (
    !before.sellingSaleGrossPrice ||
    !before.sellingSaleStartsAt ||
    !before.sellingSaleEndsAt
  )
    return null;
  return {
    grossPrice: before.sellingSaleGrossPrice.toString(),
    startsAt: before.sellingSaleStartsAt.toISOString(),
    endsAt: before.sellingSaleEndsAt.toISOString(),
  };
}

async function lockProduct(
  transaction: ProductTransaction,
  productId: string,
): Promise<void> {
  await transaction.$queryRaw`SELECT "id" FROM "Product" WHERE "id" = ${productId} FOR UPDATE`;
}

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

  /**
   * AZ ELTÉRÉS-SZŰRŐ (a82ed229, 2d): azok a termékek, ahol egy kézi jelző mást mond, mint a termék UNAS-adata ma
   * (`manualFlagsDifferingFromUnas`, ugyanaz, mint a feltöltés próbájáé). A jelölt csak kézi jelzős sor lehet, és
   * UNAS-adat nélkül nincs mihez eltérni, tehát a halmaz a kézi írások számával nő, nem a katalóguséval.
   */
  private async unasDiffProductIds(): Promise<string[]> {
    const profiles = await this.productDatabase.productShippingProfile.findMany(
      {
        where: {
          OR: SHIPPING_FLAGS.map((flag) => ({ [`${flag}Source`]: "MANUAL" })),
        },
        select: {
          productId: true,
          ...Object.fromEntries(
            SHIPPING_FLAGS.flatMap((flag) => [
              [flag, true],
              [`${flag}Source`, true],
            ]),
          ),
        },
      },
    );
    if (profiles.length === 0) return [];
    const snapshots = await this.productDatabase.unasProductSnapshot.findMany({
      where: { productId: { in: profiles.map((p) => p.productId) } },
      select: { productId: true, rawPayload: true },
    });
    const payload = new Map(snapshots.map((s) => [s.productId, s.rawPayload]));
    return profiles
      .filter(
        (profile) =>
          payload.has(profile.productId) &&
          manualFlagsDifferingFromUnas(
            profile,
            unasShippingProfile(payload.get(profile.productId)),
          ).length > 0,
      )
      .map((profile) => profile.productId);
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
      ...(query.shipping === "unasDiff"
        ? { id: { in: await this.unasDiffProductIds() } }
        : shippingFilterWhere(query.shipping)),
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
              // a keresheto nevek (kartya 20b0dd47, Balazs 2026-08-31): a magyar, az angol es a nemet nev is talal
              {
                datasheet: {
                  is: {
                    OR: [
                      {
                        magyarNev: {
                          contains: query.search,
                          mode: "insensitive",
                        },
                      },
                      {
                        angolNev: {
                          contains: query.search,
                          mode: "insensitive",
                        },
                      },
                      {
                        nemetNev: {
                          contains: query.search,
                          mode: "insensitive",
                        },
                      },
                    ],
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
    const datasheetPatch = datasheetPatchOf(input);
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
            ...(datasheetPatch
              ? {
                  datasheet: {
                    upsert: { create: datasheetPatch, update: datasheetPatch },
                  },
                }
              : {}),
            ...(primaryWasProvided ? { categoryId: primaryCategoryId } : {}),
          },
          include: productInclude,
        });
        // egy kitoltott nev feloldja a mezo megtagadasat: a "kitoltve ES megtagadva" par itt nem keletkezhet. A sor NYOM NELKUL
        // nem torlodik: az indoka es az oka a termek domain-esemenyebe kerul (barracuda, #2357 review)
        const filled = filledNameFields(datasheetPatch);
        if (filled.length > 0) {
          const where = { datasheet: { productId: id }, mezo: { in: filled } };
          const refused =
            await transaction.productDatasheetFieldRefusal.findMany({
              where,
              select: { mezo: true, indok: true, oka: true, createdAt: true },
            });
          if (refused.length > 0) {
            await transaction.productDatasheetFieldRefusal.deleteMany({
              where,
            });
            await transaction.domainEvent.create({
              data: {
                id: randomUUID(),
                eventType: "product.datasheet.refusal-resolved",
                aggregateType: "Product",
                aggregateId: id,
                // a megtagadas-sor nem tarolja, ki tagadta meg; az iro a PATCH hivoja, amit ez a metodus nem kap meg
                actorUserId: null,
                occurredAt: new Date(),
                schemaVersion: 1,
                payload: {
                  resolved: refused.map((row) => ({
                    field: row.mezo,
                    reason: row.indok,
                    cause: row.oka,
                    refusedAt: row.createdAt.toISOString(),
                  })),
                } satisfies Prisma.JsonObject,
              },
            });
          }
        }

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
                  // a másolt változatnak nem lehet saját akciója: az akció saját árat kér (`setVariantSale`), ez pedig épp az első
                  saleGrossPrice: null,
                  observedAt: takenAt,
                });
            }
          priceSeed = takeoverPriceLog(steps);
        }

        /*
          A UNAS-KÖVETŐ SZÁLLÍTÁSI JELZŐK KÉZIRE (T4.1-D3, `pinUnasShippingFlags`):
          a szinkron ezután nem frissíti őket, tehát a forrásuk se állítsa, hogy
          a UNAS követi. Az érték marad, a gazda a szállítási szerkesztő lesz.
          Egy átvételkor ÉPPEN FUTÓ szinkron-kört is megfog: annak a kihagyás-halmaza a
          kör elején készült, de a jelző-írása (`applyUnasShippingFlags`) csak a még
          `UNAS` forrású jelzőt írja (`updateMany` a forrásra szűrve), tehát a kézire
          billentettet nem írja vissza.
        */
        let shippingFlagsPinned: ShippingFlag[] = [];
        if (result.count > 0) {
          const pin = pinUnasShippingFlags(
            await transaction.productShippingProfile.findUnique({
              where: { productId: id },
              // a forrás-mezők a SHIPPING_FLAGS-ból: egy ötödik jelző kézzel írt listából kimaradna, és
              // csendben nem billenne (barracuda, #2129)
              select: Object.fromEntries(
                SHIPPING_FLAGS.map((flag) => [`${flag}Source`, true]),
              ),
            }),
          );
          if (pin.data) {
            await transaction.productShippingProfile.updateMany({
              where: { productId: id },
              data: pin.data,
            });
            shippingFlagsPinned = pin.flags;
          }
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
                ...(shippingFlagsPinned.length ? { shippingFlagsPinned } : {}),
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
    /** a „most" kívülről: a rendes ár őre csak a még nem lejárt akciót nézi */
    now: Date = new Date(),
  ): Promise<ProductDetail | null> {
    // két egyidejű mentésből a Serializable tranzakció az egyiket P2034-gyel bontja: az
    // újrapróbál, és a második mentés a frissebb előtte-képpel fut le (barracuda, #2130)
    return retryOnSerializationConflict(() =>
      this.setVariantSellingPriceOnce(
        productId,
        variantId,
        grossPrice,
        actorUserId,
        now,
      ),
    );
  }

  private setVariantSellingPriceOnce(
    productId: string,
    variantId: string,
    grossPrice: Prisma.Decimal,
    actorUserId: string | undefined,
    now: Date,
  ): Promise<ProductDetail | null> {
    return this.productDatabase.$transaction(
      async (transaction) => {
        const before = await transaction.productVariant.findFirst({
          where: { id: variantId, productId },
          select: VARIANT_PRICE_BEFORE_SELECT,
        });
        if (!before) return null;
        // a futó vagy jövőbeli akció alá a rendes ár nem mehet; a lejárt akció
        // mezői a helyükön maradnak (törlést semmi nem végez), az már nem köt (barracuda, #2147)
        if (
          before.sellingSaleGrossPrice &&
          before.sellingSaleEndsAt &&
          before.sellingSaleEndsAt > now &&
          !before.sellingSaleGrossPrice.lessThan(grossPrice)
        )
          throw new VariantSaleConflict(
            "sale-not-lower",
            grossPrice.toString(),
            before.sellingSaleGrossPrice.toString(),
          );
        const currency = before.sellingPriceCurrency ?? "HUF";
        await transaction.productVariant.updateMany({
          where: { id: variantId, productId },
          data: {
            sellingGrossPrice: grossPrice,
            sellingPriceCurrency: currency,
          },
        });
        const history = await recordOwnPrice(transaction, {
          productId,
          variantId,
          currency,
          grossPrice,
          // a mentés pillanatában futó akció: a bolt annak az árát mutatja tovább, a sor ne állítsa az ellenkezőjét
          saleGrossPrice: isOwnSaleActive(before, now)
            ? before.sellingSaleGrossPrice
            : null,
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

  /**
   * A VÁLTOZAT SAJÁT AKCIÓJA (T4.1-D3, akciós ár 1. szelet): beállítás vagy, `null`
   * akcióval, törlés. Az akció a saját eladási árnál olcsóbb kell legyen
   * (`VariantSaleConflict`). A termék `updatedAt`-je lép, és esemény íródik, mint
   * az árnál.
   *
   * AMIT EZ A SZELET SZÁNDÉKOSAN NEM CSINÁL: az akció sem a boltba (vetítés), sem
   * az árelőzménybe nem kerül. A kettő együtt jön a következő szeletben, a
   * határidős esedékességgel, hogy az előzmény mindig azt rögzítse, amit a vevő
   * a boltban látott: egy most írt akció-sor egy olyan árat állítana, amit a bolt
   * még nem mutat.
   */
  async setVariantSale(
    productId: string,
    variantId: string,
    sale: VariantSale | null,
    actorUserId?: string,
    /** a „most" kívülről: a futó akció kezdetének őre ehhez mér */
    now: Date = new Date(),
  ): Promise<ProductDetail | null> {
    return retryOnSerializationConflict(() =>
      this.productDatabase.$transaction(
        async (transaction) => {
          const before = await transaction.productVariant.findFirst({
            where: { id: variantId, productId },
            select: VARIANT_PRICE_BEFORE_SELECT,
          });
          if (!before) return null;
          if (sale && !before.sellingGrossPrice)
            throw new VariantSaleConflict(
              "own-price-missing",
              null,
              sale.grossPrice.toString(),
            );
          if (sale && !sale.grossPrice.lessThan(before.sellingGrossPrice!))
            throw new VariantSaleConflict(
              "sale-not-lower",
              before.sellingGrossPrice!.toString(),
              sale.grossPrice.toString(),
            );
          /*
            A FUTÓ AKCIÓ KEZDETE NEM MOZDUL (barracuda, #2219). Az Omnibus a csökkentés kezdete előtti 30 napot nézi,
            és a saját akció kezdete a változat mezője (`currentReductionStart`): egy későbbre tett kezdet az ablakba
            húzná ugyanennek az akciónak a korábbi, akciós sorait, és az akció a saját referenciája lenne (acrobot
            41899 ezt kizárja). Az ár és a vég módosítható; új kezdet törléssel és új akcióval jár.
          */
          if (
            sale &&
            isOwnSaleActive(before, now) &&
            sale.startsAt.getTime() !== before.sellingSaleStartsAt!.getTime()
          )
            throw new VariantSaleConflict(
              "sale-start-locked",
              before.sellingGrossPrice?.toString() ?? null,
              sale.grossPrice.toString(),
            );
          await transaction.productVariant.updateMany({
            where: { id: variantId, productId },
            data: {
              sellingSaleGrossPrice: sale?.grossPrice ?? null,
              sellingSaleStartsAt: sale?.startsAt ?? null,
              sellingSaleEndsAt: sale?.endsAt ?? null,
            },
          });
          return this.touchAndRead(transaction, productId, actorUserId, {
            eventType: sale
              ? "product.variant.sale.set"
              : "product.variant.sale.cleared",
            payload: {
              variantId,
              from: saleImage(before),
              to: sale
                ? {
                    grossPrice: sale.grossPrice.toString(),
                    startsAt: sale.startsAt.toISOString(),
                    endsAt: sale.endsAt.toISOString(),
                  }
                : null,
            },
          });
        },
        { isolationLevel: "Serializable" },
      ),
    );
  }

  /**
   * EGY KÉP ALT-SZÖVEGE (T4.1-D3, 4. szelet). Csak a termék saját képén (`productId`
   * a where ágban); a termék `updatedAt`-je lép, mert a Medusa-vetítés esedékessége a
   * termék-sorból olvas, és az alt a termék metaadatában megy ki. `null`: a kép nem
   * ehhez a termékhez tartozik.
   */
  async setImageAltText(
    productId: string,
    imageId: string,
    altText: string | null,
    actorUserId?: string,
  ): Promise<ProductDetail | null> {
    return this.productDatabase.$transaction(async (transaction) => {
      const written = await transaction.productImage.updateMany({
        where: { id: imageId, productId },
        data: { altText },
      });
      if (written.count === 0) return null;
      return this.touchAndRead(transaction, productId, actorUserId, {
        eventType: "product.image.alt-text.set",
        payload: { imageId, altText },
      });
    });
  }

  /**
   * A KÉPEK SORRENDJE: a `sortOrder` a megadott sorrend indexe. A lista a termék
   * MINDEN képét pontosan egyszer tartalmazza, különben semmi nem íródik (`null`):
   * egy hiányzó kép a régi sorszámával a többi közé csúszna, egy idegen pedig egy
   * másik termék sorrendjét írná.
   */
  async setImageOrder(
    productId: string,
    imageIds: string[],
    actorUserId?: string,
  ): Promise<ProductDetail | null> {
    return this.productDatabase.$transaction(async (transaction) => {
      // egy közben feltöltött vagy törölt kép ne csússzon a beolvasás és az írás közé (barracuda, #2139)
      await lockProduct(transaction, productId);
      const own = await transaction.productImage.findMany({
        where: { productId },
        select: { id: true },
      });
      const ownIds = new Set(own.map((image) => image.id));
      if (
        imageIds.length !== ownIds.size ||
        new Set(imageIds).size !== imageIds.length ||
        imageIds.some((id) => !ownIds.has(id))
      )
        return null;
      for (const [sortOrder, id] of imageIds.entries())
        await transaction.productImage.updateMany({
          where: { id, productId },
          data: { sortOrder },
        });
      return this.touchAndRead(transaction, productId, actorUserId, {
        eventType: "product.image.order.set",
        payload: { imageIds },
      });
    });
  }

  /**
   * EGY FELTÖLTÖTT KÉP A LISTA VÉGÉRE (T4.1-D3, 6. szelet). A termék sora
   * zárolva: két egyidejű feltöltés ne kapja ugyanazt a sorszámot, és egy
   * sorrend-írás ne hagyja ki az újat. A `[productId, url]` egyedi kulcs ütközése
   * (ugyanaz a kép másodszor) P2002-vel dob; a hívó dönt róla.
   *
   * A FÁJLT A HÍVÓ A ZÁR ALATT ÍRJA (`storeFile`), a sor előtt (a sor csak létező
   * fájlra mutathat, a másoló mintája). A zár előtt írva egy egyidejű törlés
   * takarítása a sor létrejötte előtt elvihette volna (barracuda, #2142): a
   * takarítás ugyanezt a zárat veszi fel (`releaseImageFileIfUnused`).
   */
  async addUploadedImage(
    productId: string,
    image: UploadedProductImage,
    storeFile: () => Promise<void>,
    actorUserId?: string,
  ): Promise<ProductDetail> {
    return this.productDatabase.$transaction(
      async (transaction) => {
        await lockProduct(transaction, productId);
        await storeFile();
        const last = await transaction.productImage.aggregate({
          where: { productId },
          _max: { sortOrder: true },
        });
        const created = await transaction.productImage.create({
          data: {
            productId,
            url: image.url,
            storageKey: image.storageKey,
            fileName: image.fileName,
            sortOrder: (last._max.sortOrder ?? -1) + 1,
            source: UPLOADED_IMAGE_SOURCE,
          },
          select: { id: true },
        });
        return this.touchAndRead(transaction, productId, actorUserId, {
          eventType: "product.image.uploaded",
          payload: { imageId: created.id, fileName: image.fileName },
        });
      },
      // a fájl-írás a zár alatt fut: egy 10 MB-os kép lassú lemezre írva elérheti a
      // Prisma 5 mp-es alapértelmezését (barracuda, #2145)
      { timeout: UPLOAD_TRANSACTION_TIMEOUT_MS },
    );
  }

  /**
   * EGY KÉP TÖRLÉSE (T4.1-D3, 6. szelet). Csak ennek a terméknek a képe; idegen
   * vagy nem létező azonosítóra `null`, és semmi nem íródik. A törölt sort
   * visszaadja, mert a fájlt a hívó a tranzakció UTÁN viszi el: egy visszagörgetett
   * törlés után a sor megmarad, és a fájljának is meg kell maradnia.
   */
  async removeImage(
    productId: string,
    imageId: string,
    actorUserId?: string,
  ): Promise<{ product: ProductDetail; removed: StoredProductImage } | null> {
    return this.productDatabase.$transaction(async (transaction) => {
      await lockProduct(transaction, productId);
      const removed = await transaction.productImage.findFirst({
        where: { id: imageId, productId },
        select: STORED_IMAGE_SELECT,
      });
      if (!removed) return null;
      await transaction.productImage.deleteMany({
        where: { id: imageId, productId },
      });
      const product = await this.touchAndRead(
        transaction,
        productId,
        actorUserId,
        {
          eventType: "product.image.removed",
          payload: { imageId, url: removed.url },
        },
      );
      return { product, removed };
    });
  }

  /**
   * EGY KÉP FÁJLJÁNAK TAKARÍTÁSA, CSAK HA MÁR NINCS RÁ SOR (barracuda, #2142). A
   * termék zárja alatt: egy közben futó újrafeltöltés vagy előtte írta a sort
   * (akkor a fájl marad), vagy utána írja a fájlt (akkor újra felteszi). `true`,
   * ha a fájl ment.
   */
  async releaseImageFileIfUnused(
    productId: string,
    url: string,
    releaseFile: () => Promise<void>,
  ): Promise<boolean> {
    return this.productDatabase.$transaction(async (transaction) => {
      await lockProduct(transaction, productId);
      const still = await transaction.productImage.findFirst({
        where: { productId, url },
        select: STORED_IMAGE_SELECT,
      });
      if (still) return false;
      await releaseFile();
      return true;
    });
  }

  /** Egy kép sora a fájl kiolvasásához; csak ennek a terméknek a képe. */
  findImage(
    productId: string,
    imageId: string,
  ): Promise<StoredProductImage | null> {
    return this.productDatabase.productImage.findFirst({
      where: { id: imageId, productId },
      select: STORED_IMAGE_SELECT,
    });
  }

  /** A termék esedékessé tétele a vetítésnek, az esemény, és a friss részletek. */
  private async touchAndRead(
    transaction: ProductTransaction,
    productId: string,
    actorUserId: string | undefined,
    event: { eventType: string; payload: Prisma.JsonObject },
  ): Promise<ProductDetail> {
    const now = new Date();
    await transaction.product.update({
      where: { id: productId },
      data: { updatedAt: now },
    });
    await transaction.domainEvent.create({
      data: {
        id: randomUUID(),
        eventType: event.eventType,
        aggregateType: "Product",
        aggregateId: productId,
        actorUserId,
        occurredAt: now,
        schemaVersion: 1,
        payload: event.payload,
      },
    });
    const product = await transaction.product.findUnique({
      where: { id: productId },
      include: productInclude,
    });
    if (!product) throw new Error("A termék nem található.");
    return toProductDetail(product);
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
