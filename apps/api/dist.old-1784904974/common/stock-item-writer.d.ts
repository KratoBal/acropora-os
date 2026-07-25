import type { Prisma } from "@acropora/database";
export interface StockItemWriterDatabase {
    stockItem: {
        findFirst(args: unknown): Promise<{
            id: string;
        } | null>;
        update(args: unknown): Promise<unknown>;
        create(args: unknown): Promise<unknown>;
    };
}
export declare function setStockItemQuantity(database: StockItemWriterDatabase, params: {
    variantId: string;
    warehouseId: string;
    onHand: Prisma.Decimal;
}): Promise<void>;
