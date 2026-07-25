import { OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { UnasAuthService } from "../../imports/unas/unas-auth.service.js";
import { UnasCustomerSyncService } from "./unas-customer-sync.service.js";
export interface UnasCustomerSyncScheduleConfig {
    enabled: boolean;
    intervalMs: number;
    startupDelayMs: number;
}
export declare function unasCustomerSyncScheduleConfig(environment?: NodeJS.ProcessEnv): UnasCustomerSyncScheduleConfig;
export declare class UnasCustomerSyncScheduler implements OnModuleInit, OnModuleDestroy {
    private readonly auth;
    private readonly sync;
    private readonly logger;
    private timer;
    private stopped;
    constructor(auth: UnasAuthService, sync: UnasCustomerSyncService);
    onModuleInit(): void;
    onModuleDestroy(): void;
    runOnce(): Promise<"APPLIED" | "SKIPPED" | "FAILED">;
    private schedule;
}
