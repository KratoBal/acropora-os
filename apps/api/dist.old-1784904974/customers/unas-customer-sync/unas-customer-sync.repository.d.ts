import { Repository } from "@acropora/database";
import type { UnasApiCustomer, UnasCustomerSyncRun, UnasCustomerSyncSummary } from "@acropora/types";
export interface UnasCustomerSyncApplyResult extends UnasCustomerSyncSummary {
}
export declare class UnasCustomerSyncRepository extends Repository {
    constructor();
    getCursor(): Promise<Date | null>;
    createRun(input: {
        windowStart: Date | null;
        windowEnd: Date;
    }): Promise<string>;
    markFailed(runId: string, errorCode: string): Promise<void>;
    getRun(runId: string): Promise<UnasCustomerSyncRun>;
    listRuns(limit: number): Promise<UnasCustomerSyncRun[]>;
    apply(runId: string, customers: readonly UnasApiCustomer[], windowStart: Date | null, windowEnd: Date): Promise<UnasCustomerSyncApplyResult>;
}
