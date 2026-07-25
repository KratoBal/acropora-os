import type { Prisma } from "@acropora/database";
import type { PosPaymentMethod, PosSaleDetail, PosSaleListItem, SalesOrderLineSyncStatus } from "@acropora/types";
export interface SalesOrderWithRelations {
    id: string;
    orderNumber: string;
    status: string;
    paymentMethod: PosPaymentMethod | null;
    currency: string;
    totalNet: Prisma.Decimal;
    totalTax: Prisma.Decimal;
    totalGross: Prisma.Decimal;
    createdAt: Date;
    completedAt: Date | null;
    customer: {
        displayName: string;
    } | null;
    soldBy: {
        displayName: string;
    } | null;
    lines: Array<{
        id: string;
        variantId: string | null;
        sku: string;
        description: string;
        quantity: Prisma.Decimal;
        unit: string;
        unitNet: Prisma.Decimal;
        taxRate: Prisma.Decimal;
        lineGross: Prisma.Decimal;
        syncStatus: SalesOrderLineSyncStatus;
        syncError: string | null;
    }>;
}
export interface SalesOrderListWithRelations {
    id: string;
    orderNumber: string;
    status: string;
    paymentMethod: PosPaymentMethod | null;
    totalGross: Prisma.Decimal;
    createdAt: Date;
    customer: {
        displayName: string;
    } | null;
    soldBy: {
        displayName: string;
    } | null;
    _count: {
        lines: number;
    };
}
export declare function toPosSaleDetail(order: SalesOrderWithRelations): PosSaleDetail;
export declare function toPosSaleListItem(order: SalesOrderListWithRelations): PosSaleListItem;
