import type { NavIncomingInvoiceDetail, NavIncomingInvoiceListResponse } from "@acropora/types";
import { NavCredentialsService } from "../../integrations/nav/nav-credentials.service.js";
import { NavOnlineInvoiceClient } from "../../integrations/nav/nav-online-invoice.client.js";
import type { NavIncomingInvoiceListQueryDto } from "./dto/nav-incoming-invoice-list-query.dto.js";
import { NavIncomingInvoiceRepository } from "./nav-incoming-invoice.repository.js";
export declare class NavIncomingInvoiceService {
    private readonly client;
    private readonly credentials;
    private readonly repository;
    constructor(client: NavOnlineInvoiceClient, credentials: NavCredentialsService, repository: NavIncomingInvoiceRepository);
    list(query: NavIncomingInvoiceListQueryDto): Promise<NavIncomingInvoiceListResponse>;
    detail(id: string): Promise<NavIncomingInvoiceDetail>;
    sync(windowEnd?: Date): Promise<import("./nav-incoming-invoice.repository.js").NavInvoiceSyncApplyResult>;
    private downloadDigest;
}
