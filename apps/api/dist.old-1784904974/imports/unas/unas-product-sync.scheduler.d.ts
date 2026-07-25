import { OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { UnasAuthService } from "./unas-auth.service.js";
import { UnasProductSyncService } from "./unas-product-sync.service.js";
export interface UnasSyncScheduleConfig {
    enabled: boolean;
    intervalMs: number;
    startupDelayMs: number;
}
export declare function unasSyncScheduleConfig(environment?: NodeJS.ProcessEnv): UnasSyncScheduleConfig;
export declare class UnasProductSyncScheduler implements OnModuleInit, OnModuleDestroy {
    private readonly auth;
    private readonly sync;
    private readonly logger;
    private timer;
    private stopped;
    constructor(auth: UnasAuthService, sync: UnasProductSyncService);
    onModuleInit(): void;
    onModuleDestroy(): void;
    runOnce(): Promise<"APPLIED" | "SKIPPED" | "FAILED">;
    private schedule;
}
