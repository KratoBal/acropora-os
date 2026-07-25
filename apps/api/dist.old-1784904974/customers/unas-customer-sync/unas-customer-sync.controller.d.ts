import { UnasAuthService } from "../../imports/unas/unas-auth.service.js";
import { UnasCustomerSyncRunsQueryDto } from "./dto/unas-customer-sync-runs-query.dto.js";
import { UnasCustomerSyncRepository } from "./unas-customer-sync.repository.js";
import { UnasCustomerSyncService } from "./unas-customer-sync.service.js";
export declare class UnasCustomerSyncController {
    private readonly auth;
    private readonly sync;
    private readonly repository;
    constructor(auth: UnasAuthService, sync: UnasCustomerSyncService, repository: UnasCustomerSyncRepository);
    run(): Promise<import("@acropora/types").UnasCustomerSyncSummary>;
    getRun(runId: string): Promise<import("@acropora/types").UnasCustomerSyncRun>;
    listRuns(query: UnasCustomerSyncRunsQueryDto): Promise<import("@acropora/types").UnasCustomerSyncRun[]>;
}
