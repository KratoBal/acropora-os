import { Prisma, Repository } from "@acropora/database";
import type { PurchaseInvoiceDetail, PurchaseInvoiceListResponse, PurchaseInvoiceSource } from "@acropora/types";
import { type StockItemWriterDatabase } from "../common/stock-item-writer.js";
import { type WarehouseLookupDatabase } from "../common/warehouse.util.js";
import type { PurchaseInvoiceListQueryDto } from "./dto/purchase-invoice-list-query.dto.js";
import { type PurchaseInvoiceDetailRow, type PurchaseInvoiceSummaryRow } from "./purchase-invoice.types.js";
export interface PurchaseInvoiceVariantInfo {
    variantId: string;
    sku: string;
    productName: string;
    unit: string;
    currentQty: Prisma.Decimal;
}
export interface PurchaseInvoiceCurrentStock {
    warehouseId: string;
    variants: Map<string, PurchaseInvoiceVariantInfo>;
}
export interface CreatePurchaseInvoiceLine {
    variantId: string | null;
    sourceDescription: string | null;
    orderedQuantity: Prisma.Decimal;
    actualQuantity: Prisma.Decimal;
    unit: string;
    unitNet: Prisma.Decimal;
    discountPercent: Prisma.Decimal | null;
    resultingQty: Prisma.Decimal | null;
    syncStatus: "OK" | "FAILED" | "NOT_LINKED";
    syncError: string | null;
}
export interface CreatePurchaseInvoiceParams {
    documentNumber: string;
    supplierInvoiceNumber: string;
    source: PurchaseInvoiceSource;
    supplierId: string;
    warehouseId: string;
    currency: string;
    exchangeRate: Prisma.Decimal | null;
    invoiceDate: Date;
    dueDate: Date | null;
    isPaid: boolean;
    paidAt: Date | null;
    vatRate: Prisma.Decimal | null;
    note: string | null;
    navIncomingInvoiceId?: string;
    actorUserId: string;
    lines: CreatePurchaseInvoiceLine[];
}
interface PurchaseInvoiceCreateTransaction {
    purchaseInvoice: {
        create(args: unknown): Promise<PurchaseInvoiceDetailRow>;
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
    productExtension: {
        upsert(args: unknown): Promise<unknown>;
    };
    navIncomingInvoice: {
        updateMany(args: unknown): Promise<{
            count: number;
        }>;
    };
    domainEvent: {
        create(args: unknown): Promise<unknown>;
    };
}
export interface PurchaseInvoiceDatabase extends WarehouseLookupDatabase {
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
    purchaseInvoice: {
        findMany(args: unknown): Promise<PurchaseInvoiceSummaryRow[]>;
        findUnique(args: unknown): Promise<PurchaseInvoiceDetailRow | null>;
        count(args: unknown): Promise<number>;
    };
    $transaction<T>(operation: (transaction: PurchaseInvoiceCreateTransaction) => Promise<T>, options?: {
        isolationLevel: "Serializable";
        timeout?: number;
    }): Promise<T>;
}
export declare const PURCHASE_INVOICE_DATABASE: unique symbol;
export declare class PurchaseInvoiceRepository extends Repository {
    private readonly invoiceDatabase;
    constructor(invoiceDatabase?: PurchaseInvoiceDatabase);
    currentStock(variantIds: string[]): Promise<PurchaseInvoiceCurrentStock>;
    create(params: CreatePurchaseInvoiceParams): Promise<PurchaseInvoiceDetail>;
    list(query: PurchaseInvoiceListQueryDto): Promise<PurchaseInvoiceListResponse>;
    findById(id: string): Promise<PurchaseInvoiceDetail | null>;
}
export {};
