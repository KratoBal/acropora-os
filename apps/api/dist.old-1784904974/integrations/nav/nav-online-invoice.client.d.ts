import type { NavTaxpayerLookupResult } from "@acropora/types";
import { type NavSoftwareData, type NavTechnicalUser } from "./nav-xml.util.js";
export { NavApiError, type NavApiErrorCode, type NavSoftwareData, type NavTechnicalUser, } from "./nav-xml.util.js";
export type NavInvoiceDirection = "OUTBOUND" | "INBOUND";
export type NavInvoiceOperation = "CREATE" | "MODIFY" | "STORNO";
export interface NavInvoiceDigestItem {
    invoiceNumber: string;
    invoiceOperation: NavInvoiceOperation;
    invoiceIssueDate: string;
    invoiceDeliveryDate?: string;
    paymentDate?: string;
    supplierTaxNumber?: string;
    supplierName?: string;
    currency?: string;
    invoiceNetAmount?: string;
    invoiceVatAmount?: string;
    insDate: string;
}
export interface NavInvoiceDigestResult {
    currentPage: number;
    availablePage: number;
    items: NavInvoiceDigestItem[];
}
export interface NavInvoiceDataResult {
    invoiceDataBase64?: string;
    compressed: boolean;
}
export declare function parseQueryInvoiceDigestResponse(xml: string): NavInvoiceDigestResult;
export declare function parseQueryInvoiceDataResponse(xml: string): NavInvoiceDataResult;
export declare class NavOnlineInvoiceClient {
    private readonly logger;
    queryTaxpayer(targetTaxNumber: string, user: NavTechnicalUser, software: NavSoftwareData): Promise<NavTaxpayerLookupResult>;
    queryInvoiceDigest(page: number, direction: NavInvoiceDirection, insDateFrom: Date, insDateTo: Date, user: NavTechnicalUser, software: NavSoftwareData): Promise<NavInvoiceDigestResult>;
    queryInvoiceData(invoiceNumber: string, direction: NavInvoiceDirection, supplierTaxNumber: string | undefined, user: NavTechnicalUser, software: NavSoftwareData): Promise<NavInvoiceDataResult>;
    private call;
    protected request(input: string, init: RequestInit): Promise<Response>;
}
