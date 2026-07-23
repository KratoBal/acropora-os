import { Inject, Injectable, Optional } from "@nestjs/common";
import { Prisma, Repository, prisma } from "@acropora/database";
import type { PurchaseProductSearchResult } from "@acropora/types";

import {
  ensureMainWarehouse,
  type WarehouseLookupDatabase,
} from "../common/warehouse.util.js";

const SEARCH_RESULT_LIMIT = 20;

export interface PurchaseProductSearchDatabase extends WarehouseLookupDatabase {
  productVariant: {
    findMany(args: unknown): Promise<
      Array<{
        id: string;
        sku: string;
        unit: string;
        product: { name: string };
        extension: {
          lastPurchaseNetPrice: Prisma.Decimal | null;
          defaultPurchaseCurrency: string | null;
        } | null;
      }>
    >;
  };
  stockItem: {
    findMany(
      args: unknown,
    ): Promise<Array<{ variantId: string; onHand: Prisma.Decimal }>>;
  };
}

export const PURCHASE_PRODUCT_SEARCH_DATABASE = Symbol(
  "PURCHASE_PRODUCT_SEARCH_DATABASE",
);

@Injectable()
export class PurchaseProductSearchRepository extends Repository {
  private readonly searchDatabase: PurchaseProductSearchDatabase;

  constructor(
    @Optional()
    @Inject(PURCHASE_PRODUCT_SEARCH_DATABASE)
    searchDatabase?: PurchaseProductSearchDatabase,
  ) {
    super(prisma);
    this.searchDatabase =
      searchDatabase ?? (prisma as unknown as PurchaseProductSearchDatabase);
  }

  async search(query: string): Promise<PurchaseProductSearchResult[]> {
    const term = query.trim();
    if (!term) return [];

    const warehouse = await ensureMainWarehouse(this.searchDatabase);

    const variants = await this.searchDatabase.productVariant.findMany({
      where: {
        isActive: true,
        product: { isActive: true },
        OR: [
          { sku: { contains: term, mode: "insensitive" } },
          { product: { name: { contains: term, mode: "insensitive" } } },
          { barcodes: { some: { code: { contains: term } } } },
        ],
      },
      select: {
        id: true,
        sku: true,
        unit: true,
        product: { select: { name: true } },
        extension: {
          select: {
            lastPurchaseNetPrice: true,
            defaultPurchaseCurrency: true,
          },
        },
      },
      orderBy: { sku: "asc" },
      take: SEARCH_RESULT_LIMIT,
    });
    if (variants.length === 0) return [];

    const stockItems = await this.searchDatabase.stockItem.findMany({
      where: {
        warehouseId: warehouse.id,
        locationId: null,
        lotId: null,
        variantId: { in: variants.map((variant) => variant.id) },
      },
      select: { variantId: true, onHand: true },
    });
    const onHandByVariant = new Map(
      stockItems.map((item) => [item.variantId, item.onHand]),
    );

    return variants.map((variant) => ({
      variantId: variant.id,
      sku: variant.sku,
      productName: variant.product.name,
      unit: variant.unit,
      lastPurchaseNetPrice:
        variant.extension?.lastPurchaseNetPrice?.toString() ?? undefined,
      lastPurchaseCurrency:
        variant.extension?.defaultPurchaseCurrency ?? undefined,
      currentStock: (
        onHandByVariant.get(variant.id) ?? new Prisma.Decimal(0)
      ).toString(),
    }));
  }
}
