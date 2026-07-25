import { OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { NavIncomingInvoiceService } from "./nav-incoming-invoice.service.js";
export interface NavInvoiceSyncScheduleConfig {
    enabled: boolean;
    intervalMs: number;
    startupDelayMs: number;
}
export declare function navInvoiceSyncScheduleConfig(environment?: NodeJS.ProcessEnv): NavInvoiceSyncScheduleConfig;
export declare class NavIncomingInvoiceScheduler implements OnModuleInit, OnModuleDestroy {
    private readonly sync;
    private readonly logger;
    private timer;
    private stopped;
    constructor(sync: NavIncomingInvoiceService);
    onModuleInit(): void;
    onModuleDestroy(): void;
    runOnce(): Promise<"APPLIED" | "SKIPPED" | "FAILED">;
    private schedule;
}
