import { Prisma, Repository } from "@acropora/database";
import type { InventoryCountDetail, InventoryCountListResponse } from "@acropora/types";
import { type StockItemWriterDatabase } from "../common/stock-item-writer.js";
import { type WarehouseLookupDatabase } from "../common/warehouse.util.js";
import type { InventoryCountListQueryDto } from "./dto/inventory-count-list-query.dto.js";
import { type InventoryCountListWithRelations, type InventoryCountWithRelations } from "./inventory-count.types.js";
export interface InventoryCountLinePushResult {
    lineId: string;
    status: "OK" | "FAILED";
    errorMessage: string | null;
}
export interface InventoryCountApplyResultRow {
    detail: InventoryCountDetail;
    movementNumber: string;
    successCount: number;
    failedCount: number;
}
interface InventoryCountApplyTransaction {
    inventoryCountLine: {
        findMany(args: unknown): Promise<Array<{
            id: string;
            variantId: string;
            expectedQty: Prisma.Decimal;
            countedQty: Prisma.Decimal | null;
            variant: {
                sku: string;
                unit: string;
            };
        }>>;
        update(args: unknown): Promise<unknown>;
    };
    stockItem: StockItemWriterDatabase["stockItem"] & {
        findMany(args: unknown): Promise<Array<{
            variantId: string;
        }>>;
    };
    stockMovement: {
        create(args: unknown): Promise<{
            id: string;
            movementNumber: string;
        }>;
    };
    stockMovementLine: {
        create(args: unknown): Promise<unknown>;
    };
    inventoryCount: {
        update(args: unknown): Promise<InventoryCountWithRelations>;
    };
}
export interface InventoryCountDatabase {
    warehouse: WarehouseLookupDatabase["warehouse"];
    productVariant: {
        findMany(args: unknown): Promise<Array<{
            id: string;
            sku: string;
            unit: string;
            product: {
                name: string;
                unasSnapshot: {
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
    inventoryCount: {
        create(args: unknown): Promise<InventoryCountWithRelations>;
        findMany(args: unknown): Promise<InventoryCountListWithRelations[]>;
        findUnique(args: unknown): Promise<InventoryCountWithRelations | null>;
        count(args: unknown): Promise<number>;
    };
    inventoryCountLine: {
        updateMany(args: unknown): Promise<unknown>;
        update(args: unknown): Promise<unknown>;
    };
    $transaction<T>(operation: (transaction: InventoryCountApplyTransaction) => Promise<T>, options?: {
        isolationLevel: "Serializable";
        timeout?: number;
    }): Promise<T>;
}
export declare const INVENTORY_COUNT_DATABASE: unique symbol;
export declare class InventoryCountRepository extends Repository {
    private readonly countDatabase;
    constructor(countDatabase?: InventoryCountDatabase);
    list(query: InventoryCountListQueryDto): Promise<InventoryCountListResponse>;
    findById(id: string): Promise<InventoryCountDetail | null>;
    create(actorUserId: string): Promise<InventoryCountDetail>;
    markUploaded(id: string, rows: {
        sku: string;
        countedQty: string;
    }[]): Promise<{
        detail: InventoryCountDetail;
        unmatchedSkus: string[];
    }>;
    updateLineCount(inventoryCountId: string, lineId: string, countedQty: string): Promise<InventoryCountDetail>;
    applyCorrection(id: string, actorUserId: string, pushResults: Map<string, InventoryCountLinePushResult>): Promise<InventoryCountApplyResultRow>;
}
export {};
