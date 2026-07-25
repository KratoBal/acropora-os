import { UnasAuthService } from "../../imports/unas/unas-auth.service.js";
import { UnasOrderListQueryDto } from "./dto/unas-order-list-query.dto.js";
import { UnasOrderSyncRunsQueryDto } from "./dto/unas-order-sync-runs-query.dto.js";
import { UnasOrderSyncRepository } from "./unas-order-sync.repository.js";
import { UnasOrderSyncService } from "./unas-order-sync.service.js";
export declare class UnasOrderSyncController {
    private readonly auth;
    private readonly sync;
    private readonly repository;
    constructor(auth: UnasAuthService, sync: UnasOrderSyncService, repository: UnasOrderSyncRepository);
    run(): Promise<import("@acropora/types").UnasOrderSyncSummary>;
    getRun(runId: string): Promise<import("@acropora/types").UnasOrderSyncRun>;
    listRuns(query: UnasOrderSyncRunsQueryDto): Promise<import("@acropora/types").UnasOrderSyncRun[]>;
    checkStockReconciliation(): Promise<import("@acropora/types").StockReconciliationReport>;
    list(query: UnasOrderListQueryDto): Promise<import("@acropora/types").UnasOrderListResponse>;
    getOne(id: string): Promise<import("@acropora/types").UnasOrderDetail>;
}
