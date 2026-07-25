import { type AuthenticatedUser } from "@acropora/types";
import { CreatePurchaseInvoiceDto } from "./dto/create-purchase-invoice.dto.js";
import { ExchangeRateQueryDto } from "./dto/exchange-rate-query.dto.js";
import { PurchaseInvoiceListQueryDto } from "./dto/purchase-invoice-list-query.dto.js";
import { PurchaseProductSearchQueryDto } from "./dto/purchase-product-search-query.dto.js";
import { PurchasingService } from "./purchasing.service.js";
export declare class PurchasingController {
    private readonly service;
    constructor(service: PurchasingService);
    searchProducts(query: PurchaseProductSearchQueryDto): Promise<import("@acropora/types").PurchaseProductSearchResult[]>;
    getExchangeRate(query: ExchangeRateQueryDto): Promise<import("@acropora/types").ExchangeRateLookupResult>;
    listInvoices(query: PurchaseInvoiceListQueryDto): Promise<import("@acropora/types").PurchaseInvoiceListResponse>;
    getInvoice(id: string): Promise<import("@acropora/types").PurchaseInvoiceDetail>;
    createInvoice(input: CreatePurchaseInvoiceDto, user: AuthenticatedUser): Promise<import("@acropora/types").PurchaseInvoiceResult>;
}
