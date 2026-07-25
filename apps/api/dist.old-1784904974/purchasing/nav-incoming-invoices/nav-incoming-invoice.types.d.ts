import type { Prisma } from "@acropora/database";
import type { NavIncomingInvoiceDetail, NavIncomingInvoiceStatus, NavIncomingInvoiceSummary } from "@acropora/types";
import type { ParsedNavInvoiceData } from "../../integrations/nav/nav-invoice-data.parser.js";
export interface StoredNavInvoiceParsedData extends ParsedNavInvoiceData {
    suggestedVatRatePercent?: string;
}
export interface NavIncomingInvoiceRow {
    id: string;
    navInvoiceNumber: string;
    supplierTaxNumber: string;
    supplierName: string;
    invoiceIssueDate: Date;
    invoiceDeliveryDate: Date | null;
    paymentDate: Date | null;
    currency: string;
    invoiceNetAmount: Prisma.Decimal | null;
    invoiceVatAmount: Prisma.Decimal | null;
    insDate: Date;
    status: NavIncomingInvoiceStatus;
    parsedData: Prisma.JsonValue | null;
    errorCode: string | null;
    purchaseInvoiceId: string | null;
}
export declare function toNavIncomingInvoiceSummary(row: NavIncomingInvoiceRow): NavIncomingInvoiceSummary;
export declare function toNavIncomingInvoiceDetail(row: NavIncomingInvoiceRow): NavIncomingInvoiceDetail;
