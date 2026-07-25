import { Prisma, Repository } from "@acropora/database";
import type { PurchaseProductSearchResult } from "@acropora/types";
import { type WarehouseLookupDatabase } from "../common/warehouse.util.js";
export interface PurchaseProductSearchDatabase extends WarehouseLookupDatabase {
    productVariant: {
        findMany(args: unknown): Promise<Array<{
            id: string;
            sku: string;
            unit: string;
            product: {
                name: string;
            };
            extension: {
                lastPurchaseNetPrice: Prisma.Decimal | null;
                defaultPurchaseCurrency: string | null;
            } | null;
        }>>;
    };
    stockItem: {
        findMany(args: unknown): Promise<Array<{
            variantId: string;
            onHand: Prisma.Decimal;
        }>>;
    };
}
export declare const PURCHASE_PRODUCT_SEARCH_DATABASE: unique symbol;
export declare class PurchaseProductSearchRepository extends Repository {
    private readonly searchDatabase;
    constructor(searchDatabase?: PurchaseProductSearchDatabase);
    search(query: string): Promise<PurchaseProductSearchResult[]>;
}
