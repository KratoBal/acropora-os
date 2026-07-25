import type { UnasCustomerSyncSummary } from "@acropora/types";
import { UnasApiClient } from "../../imports/unas/unas-api.client.js";
import { UnasCustomerSyncRepository } from "./unas-customer-sync.repository.js";
export declare class UnasCustomerSyncService {
    private readonly api;
    private readonly repository;
    constructor(api: UnasApiClient, repository: UnasCustomerSyncRepository);
    runIncremental(token: string, windowEnd?: Date, pageSize?: number): Promise<UnasCustomerSyncSummary>;
    private downloadCustomers;
}
