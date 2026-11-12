import { Injectable } from "@nestjs/common";
import { prisma, type Prisma } from "@acropora/database";

import type { ProductRow } from "./product-data.view.js";

/**
 * THE QUESTION THE CONTENT AGENT MAY ASK (spec 3: one or several identifiers, a category listing, "everything on sale
 * now"). Every field is optional, at least one selector is required (the service enforces it: an unconstrained read of
 * the whole catalogue is not a lookup).
 */
export interface ProductDataQuery {
  /** each value is a product id OR a variant SKU */
  identifiers?: string[];
  /** a category and everything below it */
  categoryIds?: string[];
  /** only products with a sale running now */
  onSale?: boolean;
}

/** A livestock arrival that has already arrived stays visible for this long, then it is history. */
const ARRIVED_VISIBLE_DAYS = 14;

/**
 * THE WHERE CLAUSE, PURE, so it can be tested without a database.
 *
 * ON SALE MIRRORS THE PRICE DECISION, not a looser guess: a product we own is on sale when one of its variants' own
 * sale window covers now; a UNAS-owned product when its mirror's sale price is set and the window (open ends allowed)
 * covers now. A mirror sale on a product we have taken over is frozen history, not a sale, so it is NOT matched.
 * Whatever this over-matches the view re-decides with `resolvePriceSource` before anything is reported as a sale.
 */
export function productDataWhere(
  query: ProductDataQuery,
  now: Date,
): Prisma.ProductWhereInput {
  const and: Prisma.ProductWhereInput[] = [];
  if (query.identifiers && query.identifiers.length > 0)
    and.push({
      OR: [
        { id: { in: query.identifiers } },
        { variants: { some: { sku: { in: query.identifiers } } } },
      ],
    });
  const hasIdentifiers = (query.identifiers?.length ?? 0) > 0;
  const hasCategories = (query.categoryIds?.length ?? 0) > 0;
  // A LISTING (a category or the on-sale list, with no identifier named) is about what is sold: inactive and archived
  // products are left out. A lookup BY IDENTIFIER hides nothing: the agent asked for that one, and `active` tells.
  if (!hasIdentifiers && (hasCategories || query.onSale))
    and.push({ isActive: true, archivedAt: null });
  if (query.categoryIds && query.categoryIds.length > 0)
    and.push({
      categories: { some: { categoryId: { in: query.categoryIds } } },
    });
  if (query.onSale) {
    and.push({
      OR: [
        {
          catalogAuthority: "ACROPORA",
          variants: {
            some: {
              sellingSaleGrossPrice: { not: null },
              sellingSaleStartsAt: { lte: now },
              sellingSaleEndsAt: { gt: now },
            },
          },
        },
        {
          catalogAuthority: "UNAS",
          unasSnapshot: {
            is: {
              saleGrossPrice: { not: null },
              AND: [
                {
                  OR: [{ saleStartsAt: null }, { saleStartsAt: { lte: now } }],
                },
                { OR: [{ saleEndsAt: null }, { saleEndsAt: { gte: now } }] },
              ],
            },
          },
        },
      ],
    });
  }
  return { AND: and };
}

/** Category ids below (and including) the given ones, from the whole tree (a few hundred rows). */
export function categoryDescendants(
  rootIds: readonly string[],
  edges: readonly { id: string; parentId: string | null }[],
): string[] {
  const children = new Map<string, string[]>();
  for (const edge of edges)
    if (edge.parentId !== null)
      children.set(edge.parentId, [
        ...(children.get(edge.parentId) ?? []),
        edge.id,
      ]);
  const seen = new Set<string>();
  const queue = [...rootIds];
  while (queue.length > 0) {
    const id = queue.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    queue.push(...(children.get(id) ?? []));
  }
  return [...seen];
}

/**
 * THE SELECT LIST IS THE BOUNDARY (spec 3). `ProductExtension` sits one relation away from the variant and holds the
 * purchase price and the preferred supplier; `PurchaseOrder` holds the supplier; `StockItem` the warehouse. A generous
 * `include` would carry them out, so none is used: only the named fields below can leave.
 */
const select = (now: Date) =>
  ({
    id: true,
    name: true,
    isActive: true,
    archivedAt: true,
    type: true,
    catalogAuthority: true,
    brand: { select: { name: true } },
    categories: {
      select: { category: { select: { id: true, name: true } } },
    },
    channelListings: {
      select: { channel: true, isPublished: true, productUrl: true },
    },
    unasSnapshot: {
      select: {
        grossPrice: true,
        currency: true,
        saleGrossPrice: true,
        saleStartsAt: true,
        saleEndsAt: true,
        productUrl: true,
      },
    },
    shippingProfile: { select: { pickupOnly: true, isFrozen: true } },
    livestockArrivals: {
      where: {
        OR: [
          { status: { in: ["ORDERED", "IN_TRANSIT"] } },
          {
            status: "ARRIVED",
            updatedAt: {
              gte: new Date(now.getTime() - ARRIVED_VISIBLE_DAYS * 86_400_000),
            },
          },
        ],
      },
      select: {
        expectedOn: true,
        quantity: true,
        status: true,
        preorderable: true,
        updatedAt: true,
      },
    },
    variants: {
      orderBy: { sku: "asc" },
      select: {
        id: true,
        sku: true,
        name: true,
        isActive: true,
        sellingGrossPrice: true,
        sellingPriceCurrency: true,
        sellingSaleGrossPrice: true,
        sellingSaleStartsAt: true,
        sellingSaleEndsAt: true,
        unasVariantExtraGrossPrice: true,
        extension: { select: { stockTrackingEnabled: true } },
        stockItems: {
          select: { onHand: true, reserved: true, updatedAt: true },
        },
        inventoryCountLines: {
          where: {
            countedQty: { not: null },
            inventoryCount: { status: "CORRECTED" },
          },
          select: { inventoryCount: { select: { correctedAt: true } } },
        },
        purchaseLines: {
          where: {
            purchaseOrder: { status: { in: ["SENT", "PARTIALLY_RECEIVED"] } },
          },
          select: {
            orderedQuantity: true,
            receivedQuantity: true,
            expectedAt: true,
            purchaseOrder: { select: { expectedAt: true, updatedAt: true } },
          },
        },
      },
    },
  }) satisfies Prisma.ProductSelect;

@Injectable()
export class ProductDataRepository {
  async categoryTree(): Promise<{ id: string; parentId: string | null }[]> {
    return prisma.category.findMany({ select: { id: true, parentId: true } });
  }

  /**
   * WHICH OF THE REQUESTED IDENTIFIERS EXIST, independent of the page, the offset and every other filter. `notFound` is
   * computed from this and nothing else: a product that exists but sits on another page, outside the category or off the
   * sale list is NOT "not found" (a false absence is as wrong as a swallowed one). Only ids and SKUs are selected.
   */
  existing(
    identifiers: readonly string[],
  ): Promise<{ id: string; variants: { sku: string }[] }[]> {
    return prisma.product.findMany({
      where: productDataWhere({ identifiers: [...identifiers] }, new Date()),
      select: { id: true, variants: { select: { sku: true } } },
    });
  }

  count(where: Prisma.ProductWhereInput): Promise<number> {
    return prisma.product.count({ where });
  }

  async rows(
    where: Prisma.ProductWhereInput,
    page: { take: number; skip: number },
    now: Date,
  ): Promise<ProductRow[]> {
    const found = await prisma.product.findMany({
      where,
      select: select(now),
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: page.take,
      skip: page.skip,
    });
    const ids = found.map((product) => product.id);
    const changes =
      ids.length === 0
        ? []
        : await prisma.productPriceHistory.groupBy({
            by: ["productId", "variantId"],
            where: { productId: { in: ids } },
            _max: { observedAt: true },
          });
    return found.map(({ variants, livestockArrivals, ...product }) => ({
      ...product,
      // the query already leaves CANCELLED out; the guard narrows the type and keeps it out if the query changes
      livestockArrivals: livestockArrivals.flatMap((arrival) =>
        arrival.status === "CANCELLED"
          ? []
          : [{ ...arrival, status: arrival.status }],
      ),
      priceChanges: changes
        .filter((c) => c.productId === product.id && c._max.observedAt)
        .map((c) => ({ variantId: c.variantId, at: c._max.observedAt! })),
      variants: variants.map(({ inventoryCountLines, ...variant }) => ({
        ...variant,
        countedLines: inventoryCountLines,
      })),
    }));
  }
}
