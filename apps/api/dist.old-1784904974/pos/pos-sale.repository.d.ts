import { Prisma, Repository } from "@acropora/database";
import type { PosPaymentMethod, PosSaleDetail, PosSaleListResponse } from "@acropora/types";
import { type StockItemWriterDatabase } from "../common/stock-item-writer.js";
import { type WarehouseLookupDatabase } from "../common/warehouse.util.js";
import type { PosSaleListQueryDto } from "./dto/pos-sale-list-query.dto.js";
import { type SalesOrderListWithRelations, type SalesOrderWithRelations } from "./pos-sale.types.js";
export interface PosSaleVariantInfo {
    variantId: string;
    sku: string;
    productName: string;
    unit: string;
    vatRate: Prisma.Decimal | null;
    currentQty: Prisma.Decimal;
}
export interface PosSaleCurrentStock {
    warehouseId: string;
    variants: Map<string, PosSaleVariantInfo>;
}
export interface CreatePosSaleLine {
    variantId: string;
    sku: string;
    productName: string;
    unit: string;
    quantity: Prisma.Decimal;
    taxRate: Prisma.Decimal;
    unitNet: Prisma.Decimal;
    lineGross: Prisma.Decimal;
    resultingQty: Prisma.Decimal;
    syncStatus: "OK" | "FAILED";
    syncError: string | null;
}
export interface CreatePosSaleParams {
    orderNumber: string;
    warehouseId: string;
    actorUserId: string;
    paymentMethod: PosPaymentMethod;
    customerId: string | null;
    lines: CreatePosSaleLine[];
    totals: {
        totalNet: Prisma.Decimal;
        totalTax: Prisma.Decimal;
        totalGross: Prisma.Decimal;
    };
}
interface PosSaleTransaction {
    salesOrder: {
        create(args: unknown): Promise<SalesOrderWithRelations>;
    };
    stockMovement: {
        create(args: unknown): Promise<{
            id: string;
        }>;
    };
    stockMovementLine: {
        create(args: unknown): Promise<unknown>;
    };
    stockItem: StockItemWriterDatabase["stockItem"];
}
export interface PosSaleDatabase extends WarehouseLookupDatabase {
    productVariant: {
        findMany(args: unknown): Promise<Array<{
            id: string;
            sku: string;
            unit: string;
            vatRate: Prisma.Decimal | null;
            product: {
                name: string;
                unasSnapshot: {
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
    salesOrder: {
        findMany(args: unknown): Promise<SalesOrderListWithRelations[]>;
        findUnique(args: unknown): Promise<SalesOrderWithRelations | null>;
        count(args: unknown): Promise<number>;
    };
    $transaction<T>(operation: (transaction: PosSaleTransaction) => Promise<T>): Promise<T>;
}
export declare const POS_SALE_DATABASE: unique symbol;
export declare class PosSaleRepository extends Repository {
    private readonly saleDatabase;
    constructor(saleDatabase?: PosSaleDatabase);
    currentStock(variantIds: string[]): Promise<PosSaleCurrentStock>;
    createSale(params: CreatePosSaleParams): Promise<PosSaleDetail>;
    list(query: PosSaleListQueryDto): Promise<PosSaleListResponse>;
    findById(id: string): Promise<PosSaleDetail | null>;
}
export {};
