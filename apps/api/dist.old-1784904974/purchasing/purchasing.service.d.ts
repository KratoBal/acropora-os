import type { ExchangeRateLookupResult, PurchaseInvoiceDetail, PurchaseInvoiceListResponse, PurchaseInvoiceResult, PurchaseProductSearchResult } from "@acropora/types";
import { UnasApiClient } from "../imports/unas/unas-api.client.js";
import { UnasAuthService } from "../imports/unas/unas-auth.service.js";
import { MnbExchangeRateService } from "../integrations/mnb/mnb-exchange-rate.service.js";
import { SuppliersRepository } from "../suppliers/suppliers.repository.js";
import type { CreatePurchaseInvoiceDto } from "./dto/create-purchase-invoice.dto.js";
import type { PurchaseInvoiceListQueryDto } from "./dto/purchase-invoice-list-query.dto.js";
import { PurchaseInvoiceRepository } from "./purchase-invoice.repository.js";
import { PurchaseProductSearchService } from "./purchase-product-search.service.js";
export declare class PurchasingService {
    private readonly invoices;
    private readonly suppliers;
    private readonly productSearch;
    private readonly mnbRates;
    private readonly unasApi;
    private readonly unasAuth;
    constructor(invoices: PurchaseInvoiceRepository, suppliers: SuppliersRepository, productSearch: PurchaseProductSearchService, mnbRates: MnbExchangeRateService, unasApi: UnasApiClient, unasAuth: UnasAuthService);
    searchProducts(query: string | undefined): Promise<PurchaseProductSearchResult[]>;
    getExchangeRate(currency: string, date: string): Promise<ExchangeRateLookupResult>;
    private mapExchangeRateError;
    list(query: PurchaseInvoiceListQueryDto): Promise<PurchaseInvoiceListResponse>;
    getDetail(id: string): Promise<PurchaseInvoiceDetail>;
    createInvoice(input: CreatePurchaseInvoiceDto, actorUserId: string): Promise<PurchaseInvoiceResult>;
}
