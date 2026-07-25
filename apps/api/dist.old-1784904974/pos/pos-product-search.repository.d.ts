import { Prisma, Repository } from "@acropora/database";
import type { PosProductSearchResult } from "@acropora/types";
import { type WarehouseLookupDatabase } from "../common/warehouse.util.js";
export interface PosProductSearchDatabase extends WarehouseLookupDatabase {
    productVariant: {
        findMany(args: unknown): Promise<Array<{
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
        }>>;
    };
    stockItem: {
        findMany(args: unknown): Promise<Array<{
            variantId: string;
            onHand: Prisma.Decimal;
        }>>;
    };
}
export declare const POS_PRODUCT_SEARCH_DATABASE: unique symbol;
export declare class PosProductSearchRepository extends Repository {
    private readonly searchDatabase;
    constructor(searchDatabase?: PosProductSearchDatabase);
    search(query: string): Promise<PosProductSearchResult[]>;
}
