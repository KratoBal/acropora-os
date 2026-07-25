import { Prisma } from "@acropora/database";
import type { PurchaseInvoiceDetail, PurchaseInvoiceSummary } from "@acropora/types";
export declare const purchaseInvoiceSummaryInclude: {
    supplier: {
        select: {
            name: true;
        };
    };
    lines: {
        select: {
            actualQuantity: true;
            unitNet: true;
            discountPercent: true;
        };
    };
};
export declare const purchaseInvoiceDetailInclude: {
    supplier: {
        select: {
            name: true;
        };
    };
    lines: {
        include: {
            variant: {
                select: {
                    sku: true;
                    product: {
                        select: {
                            name: true;
                        };
                    };
                };
            };
        };
    };
};
export type PurchaseInvoiceSummaryRow = Prisma.PurchaseInvoiceGetPayload<{
    include: typeof purchaseInvoiceSummaryInclude;
}>;
export type PurchaseInvoiceDetailRow = Prisma.PurchaseInvoiceGetPayload<{
    include: typeof purchaseInvoiceDetailInclude;
}>;
export declare function toPurchaseInvoiceSummary(invoice: PurchaseInvoiceSummaryRow): PurchaseInvoiceSummary;
export declare function toPurchaseInvoiceDetail(invoice: PurchaseInvoiceDetailRow): PurchaseInvoiceDetail;
