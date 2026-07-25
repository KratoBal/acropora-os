import { Prisma, Repository } from "@acropora/database";
import type { StockReconciliationReport, UnasApiOrder, UnasOrderDetail, UnasOrderListResponse, UnasOrderSyncRun, UnasOrderSyncSummary } from "@acropora/types";
import { type WarehouseLookupDatabase } from "../../common/warehouse.util.js";
import type { UnasOrderListQueryDto } from "./dto/unas-order-list-query.dto.js";
import { type SalesOrderListWithRelations, type SalesOrderWithRelations } from "./unas-order-sync.types.js";
interface ExternalReferenceRow {
    id: string;
    entityId: string;
}
interface OrderLineRow {
    id: string;
    variantId: string | null;
    quantity: Prisma.Decimal;
    syncStatus: string;
}
interface OrderRow {
    id: string;
    status: string;
    lines: OrderLineRow[];
}
interface UnasOrderSyncTransaction extends WarehouseLookupDatabase {
    stockItem: {
        findFirst(args: unknown): Promise<{
            id: string;
            onHand: Prisma.Decimal;
        } | null>;
        update(args: unknown): Promise<unknown>;
        create(args: unknown): Promise<unknown>;
    };
    externalReference: {
        findUnique(args: unknown): Promise<ExternalReferenceRow | null>;
        create(args: unknown): Promise<unknown>;
        update(args: unknown): Promise<unknown>;
    };
    productVariant: {
        findFirst(args: unknown): Promise<{
            id: string;
        } | null>;
    };
    salesOrder: {
        create(args: unknown): Promise<{
            id: string;
        }>;
        update(args: unknown): Promise<unknown>;
        findUnique(args: unknown): Promise<OrderRow | null>;
    };
    stockMovement: {
        create(args: unknown): Promise<{
            id: string;
        }>;
        findFirst(args: unknown): Promise<{
            id: string;
        } | null>;
    };
    stockMovementLine: {
        create(args: unknown): Promise<unknown>;
    };
    unasOrderSyncRun: {
        updateMany(args: unknown): Promise<unknown>;
        create(args: unknown): Promise<{
            id: string;
        }>;
        findUniqueOrThrow(args: unknown): Promise<{
            status: string;
        }>;
        update(args: unknown): Promise<unknown>;
    };
    integrationCursor: {
        upsert(args: unknown): Promise<unknown>;
    };
}
export interface UnasOrderSyncDatabase {
    unasOrderSyncRun: {
        updateMany(args: unknown): Promise<unknown>;
        create(args: unknown): Promise<{
            id: string;
        }>;
        findUnique(args: unknown): Promise<Record<string, unknown> | null>;
        findMany(args: unknown): Promise<Array<Record<string, unknown>>>;
    };
    integrationCursor: {
        findUnique(args: unknown): Promise<{
            lastSuccessfulWindowEnd: Date | null;
        } | null>;
    };
    salesOrder: {
        findMany(args: unknown): Promise<SalesOrderListWithRelations[]>;
        findUnique(args: unknown): Promise<SalesOrderWithRelations | null>;
        count(args: unknown): Promise<number>;
    };
    product: {
        findMany(args: unknown): Promise<Array<{
            id: string;
            name: string;
            unasSnapshot: {
                reportedStock: Prisma.Decimal | null;
                reportedStockSyncedAt: Date | null;
            } | null;
            variants: Array<{
                id: string;
                sku: string;
            }>;
        }>>;
    };
    stockItem: {
        findMany(args: unknown): Promise<Array<{
            variantId: string;
            onHand: Prisma.Decimal;
        }>>;
    };
    externalReference: {
        findUnique(args: unknown): Promise<{
            metadata: Prisma.JsonValue;
        } | null>;
        findMany(args: unknown): Promise<Array<{
            entityId: string;
            metadata: Prisma.JsonValue;
        }>>;
    };
    $transaction<T>(operation: (transaction: UnasOrderSyncTransaction) => Promise<T>, options?: unknown): Promise<T>;
}
export declare const UNAS_ORDER_SYNC_DATABASE: unique symbol;
export declare class UnasOrderSyncRepository extends Repository {
    private readonly syncDatabase;
    constructor(database?: UnasOrderSyncDatabase);
    getCursor(): Promise<Date | null>;
    createRun(input: {
        windowStart: Date | null;
        windowEnd: Date;
    }): Promise<string>;
    markFailed(runId: string, errorCode: string): Promise<void>;
    getRun(runId: string): Promise<UnasOrderSyncRun>;
    listRuns(limit: number): Promise<UnasOrderSyncRun[]>;
    apply(runId: string, orders: readonly UnasApiOrder[], windowStart: Date | null, windowEnd: Date): Promise<UnasOrderSyncSummary>;
    recordStockMismatchCount(runId: string, stockMismatchCount: number): Promise<void>;
    private createNewOrder;
    private reverseOrder;
    list(query: UnasOrderListQueryDto): Promise<UnasOrderListResponse>;
    findById(id: string): Promise<UnasOrderDetail | null>;
    private loadMetadataFor;
    findStockDiscrepancies(): Promise<StockReconciliationReport>;
}
export {};
