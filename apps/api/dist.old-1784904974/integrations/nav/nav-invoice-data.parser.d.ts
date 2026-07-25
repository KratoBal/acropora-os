import { type XmlNode } from "./nav-xml.util.js";
export interface ParsedNavInvoiceLine {
    lineNumber: number;
    description: string;
    quantity: string;
    unit: string;
    unitPrice?: string;
    lineNetAmount: string;
    vatRatePercent?: string;
}
export interface ParsedNavInvoiceAddress {
    postalCode: string;
    city: string;
    line1: string;
    country: string;
}
export interface ParsedNavInvoiceData {
    supplierTaxNumber?: string;
    supplierName: string;
    supplierAddress?: ParsedNavInvoiceAddress;
    supplierBankAccountNumber?: string;
    currency: string;
    exchangeRate?: string;
    invoiceIssueDate?: string;
    invoiceDeliveryDate?: string;
    paymentDate?: string;
    lines: ParsedNavInvoiceLine[];
}
export declare function suggestedVatRatePercent(lines: readonly ParsedNavInvoiceLine[]): string | undefined;
export declare function parseNavInvoiceData(root: XmlNode): ParsedNavInvoiceData;
