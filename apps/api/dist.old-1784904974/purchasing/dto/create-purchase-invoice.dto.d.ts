export declare class CreatePurchaseInvoiceLineDto {
    variantId?: string;
    sourceDescription?: string;
    orderedQuantity: number;
    actualQuantity: number;
    unit: string;
    unitNet: number;
    discountPercent?: number;
}
export declare class CreatePurchaseInvoiceDto {
    source: "EU" | "HU_MANUAL" | "HU_NAV";
    supplierId: string;
    supplierInvoiceNumber: string;
    currency: string;
    exchangeRate?: number;
    invoiceDate: string;
    dueDate?: string;
    isPaid: boolean;
    paidAt?: string;
    vatRate?: number;
    note?: string;
    navIncomingInvoiceId?: string;
    lines: CreatePurchaseInvoiceLineDto[];
}
