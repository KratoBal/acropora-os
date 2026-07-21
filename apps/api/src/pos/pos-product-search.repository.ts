import { Inject, Injectable, Optional } from "@nestjs/common";
import { Prisma, Repository, prisma } from "@acropora/database";
import type { PosProductSearchResult } from "@acropora/types";

import {
  ensureMainWarehouse,
  type WarehouseLookupDatabase,
} from "../common/warehouse.util.js";

const SEARCH_RESULT_LIMIT = 20;

export interface PosProductSearchDatabase extends WarehouseLookupDatabase {
  productVariant: {
    findMany(args: unknown): Promise<
      Array<{
        id: string;
        sku: string;
        unit: string;
        vatRate: Prisma.Decimal | null;
        product: {
          name: string;
          unasSnapshot: {
            grossPrice: Prisma.Decimal | null;
            vatRate: Prisma.Decimal | null;
            reportedStock: Prisma.Decimal | null;
          } | null;
        };
      }>
    >;
  };
  stockItem: {
    findMany(
      args: unknown,
    ): Promise<Array<{ variantId: string; onHand: Prisma.Decimal }>>;
  };
}

export const POS_PRODUCT_SEARCH_DATABASE = Symbol(
  "POS_PRODUCT_SEARCH_DATABASE",
);

@Injectable()
export class PosProductSearchRepository extends Repository {
  private readonly searchDatabase: PosProductSearchDatabase;

  constructor(
    @Optional()
    @Inject(POS_PRODUCT_SEARCH_DATABASE)
    searchDatabase?: PosProductSearchDatabase,
  ) {
    super(prisma);
    this.searchDatabase =
      searchDatabase ?? (prisma as unknown as PosProductSearchDatabase);
  }

  async search(query: string): Promise<PosProductSearchResult[]> {
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
        vatRate: true,
        product: {
          select: {
            name: true,
            unasSnapshot: {
              select: {
                grossPrice: true,
                vatRate: true,
                reportedStock: true,
              },
            },
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

    return variants.map((variant) => {
      const currentStock =
        onHandByVariant.get(variant.id) ??
        variant.product.unasSnapshot?.reportedStock ??
        new Prisma.Decimal(0);
      const vatRate =
        variant.vatRate ?? variant.product.unasSnapshot?.vatRate ?? null;
      return {
        variantId: variant.id,
        sku: variant.sku,
        productName: variant.product.name,
        unit: variant.unit,
        vatRate: vatRate ? vatRate.toString() : null,
        grossPrice:
          variant.product.unasSnapshot?.grossPrice?.toString() ?? null,
        currentStock: currentStock.toString(),
      };
    });
  }
}
