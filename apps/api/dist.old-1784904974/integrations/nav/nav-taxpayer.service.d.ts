import type { NavTaxpayerLookupResult } from "@acropora/types";
import { NavCredentialsService } from "./nav-credentials.service.js";
import { NavOnlineInvoiceClient } from "./nav-online-invoice.client.js";
export declare class NavTaxpayerService {
    private readonly client;
    private readonly credentials;
    constructor(client: NavOnlineInvoiceClient, credentials: NavCredentialsService);
    lookup(taxNumber: string): Promise<NavTaxpayerLookupResult>;
}
