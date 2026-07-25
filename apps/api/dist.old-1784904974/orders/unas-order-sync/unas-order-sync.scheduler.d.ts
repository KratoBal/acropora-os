import { OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { UnasAuthService } from "../../imports/unas/unas-auth.service.js";
import { UnasOrderSyncService } from "./unas-order-sync.service.js";
export interface UnasOrderSyncScheduleConfig {
    enabled: boolean;
    intervalMs: number;
    startupDelayMs: number;
}
export declare function unasOrderSyncScheduleConfig(environment?: NodeJS.ProcessEnv): UnasOrderSyncScheduleConfig;
export declare class UnasOrderSyncScheduler implements OnModuleInit, OnModuleDestroy {
    private readonly auth;
    private readonly sync;
    private readonly logger;
    private timer;
    private stopped;
    constructor(auth: UnasAuthService, sync: UnasOrderSyncService);
    onModuleInit(): void;
    onModuleDestroy(): void;
    runOnce(): Promise<"APPLIED" | "SKIPPED" | "FAILED">;
    private schedule;
}
