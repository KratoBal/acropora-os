import type { Prisma } from "@acropora/database";
import type { UnasOrderDetail, UnasOrderListItem } from "@acropora/types";
export interface SalesOrderWithRelations {
    id: string;
    orderNumber: string;
    status: string;
    buyerName: string | null;
    buyerEmail: string | null;
    currency: string;
    totalNet: Prisma.Decimal;
    totalTax: Prisma.Decimal;
    totalGross: Prisma.Decimal;
    orderedAt: Date | null;
    createdAt: Date;
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
        syncStatus: "PENDING" | "OK" | "FAILED";
        syncError: string | null;
    }>;
}
export interface SalesOrderListWithRelations {
    id: string;
    orderNumber: string;
    status: string;
    buyerName: string | null;
    totalGross: Prisma.Decimal;
    currency: string;
    orderedAt: Date | null;
    createdAt: Date;
    _count: {
        lines: number;
    };
}
export interface UnasOrderMetadata {
    unasStatus?: string | null;
    unasStatusType?: string | null;
    paymentName?: string | null;
    paymentType?: string | null;
    paymentStatus?: string | null;
    shippingName?: string | null;
}
export declare function toUnasOrderDetail(order: SalesOrderWithRelations, metadata?: UnasOrderMetadata | null): UnasOrderDetail;
export declare function toUnasOrderListItem(order: SalesOrderListWithRelations, metadata?: UnasOrderMetadata | null): UnasOrderListItem;
