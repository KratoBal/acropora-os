import { NavIncomingInvoiceListQueryDto } from "./dto/nav-incoming-invoice-list-query.dto.js";
import { NavInvoiceSyncRunsQueryDto } from "./dto/nav-invoice-sync-runs-query.dto.js";
import { NavIncomingInvoiceRepository } from "./nav-incoming-invoice.repository.js";
import { NavIncomingInvoiceService } from "./nav-incoming-invoice.service.js";
export declare class NavIncomingInvoiceController {
    private readonly service;
    private readonly repository;
    constructor(service: NavIncomingInvoiceService, repository: NavIncomingInvoiceRepository);
    list(query: NavIncomingInvoiceListQueryDto): Promise<import("@acropora/types").NavIncomingInvoiceListResponse>;
    detail(id: string): Promise<import("@acropora/types").NavIncomingInvoiceDetail>;
    sync(): Promise<import("./nav-incoming-invoice.repository.js").NavInvoiceSyncApplyResult>;
    getRun(runId: string): Promise<import("@acropora/types").NavInvoiceSyncRun>;
    listRuns(query: NavInvoiceSyncRunsQueryDto): Promise<import("@acropora/types").NavInvoiceSyncRun[]>;
}
