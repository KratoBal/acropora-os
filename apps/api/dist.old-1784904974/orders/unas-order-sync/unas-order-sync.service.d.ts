import type { StockReconciliationReport, UnasOrderSyncSummary } from "@acropora/types";
import { UnasApiClient } from "../../imports/unas/unas-api.client.js";
import { UnasOrderSyncRepository } from "./unas-order-sync.repository.js";
export declare class UnasOrderSyncService {
    private readonly api;
    private readonly repository;
    constructor(api: UnasApiClient, repository: UnasOrderSyncRepository);
    runIncremental(token: string, windowEnd?: Date, pageSize?: number): Promise<UnasOrderSyncSummary>;
    checkStockReconciliation(): Promise<StockReconciliationReport>;
    private downloadOrders;
}
