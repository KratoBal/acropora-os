import { Repository } from "@acropora/database";
import type { NavIncomingInvoiceListResponse, NavInvoiceSyncRun } from "@acropora/types";
import type { NavInvoiceDigestItem } from "../../integrations/nav/nav-online-invoice.client.js";
import type { NavIncomingInvoiceListQueryDto } from "./dto/nav-incoming-invoice-list-query.dto.js";
import { type NavIncomingInvoiceRow, type StoredNavInvoiceParsedData } from "./nav-incoming-invoice.types.js";
export interface NavInvoiceSyncApplyResult {
    runId: string;
    status: "APPLIED";
    invoicesSeen: number;
    createdCount: number;
    skippedCount: number;
    windowStart: string | null;
    windowEnd: string;
}
export declare class NavIncomingInvoiceRepository extends Repository {
    constructor();
    getCursor(): Promise<Date | null>;
    createRun(input: {
        windowStart: Date | null;
        windowEnd: Date;
    }): Promise<string>;
    markFailed(runId: string, errorCode: string): Promise<void>;
    getRun(runId: string): Promise<NavInvoiceSyncRun>;
    listRuns(limit: number): Promise<NavInvoiceSyncRun[]>;
    applyDigest(runId: string, items: readonly NavInvoiceDigestItem[], windowStart: Date | null, windowEnd: Date): Promise<NavInvoiceSyncApplyResult>;
    list(query: NavIncomingInvoiceListQueryDto): Promise<NavIncomingInvoiceListResponse>;
    findById(id: string): Promise<NavIncomingInvoiceRow | null>;
    saveParsedData(id: string, parsedData: StoredNavInvoiceParsedData): Promise<void>;
    markError(id: string, errorCode: string): Promise<void>;
}
