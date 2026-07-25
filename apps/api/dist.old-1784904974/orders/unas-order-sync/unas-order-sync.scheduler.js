var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var UnasOrderSyncScheduler_1;
import { ConflictException, Injectable, Logger, } from "@nestjs/common";
import { UnasAuthService } from "../../imports/unas/unas-auth.service.js";
import { UnasOrderSyncService } from "./unas-order-sync.service.js";
function boundedInteger(value, fallback, minimum, maximum, errorCode) {
    if (value === undefined || value.trim() === "")
        return fallback;
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum)
        throw new Error(errorCode);
    return parsed;
}
export function unasOrderSyncScheduleConfig(environment = process.env) {
    const enabled = environment.UNAS_ORDER_SYNC_ENABLED === "true";
    if (!enabled)
        return { enabled: false, intervalMs: 0, startupDelayMs: 0 };
    const intervalMinutes = boundedInteger(environment.UNAS_ORDER_SYNC_INTERVAL_MINUTES, 5, 1, 1440, "INVALID_UNAS_ORDER_SYNC_INTERVAL_MINUTES");
    const startupDelaySeconds = boundedInteger(environment.UNAS_ORDER_SYNC_STARTUP_DELAY_SECONDS, 30, 0, 3600, "INVALID_UNAS_ORDER_SYNC_STARTUP_DELAY_SECONDS");
    return {
        enabled,
        intervalMs: intervalMinutes * 60_000,
        startupDelayMs: startupDelaySeconds * 1000,
    };
}
let UnasOrderSyncScheduler = UnasOrderSyncScheduler_1 = class UnasOrderSyncScheduler {
    auth;
    sync;
    logger = new Logger(UnasOrderSyncScheduler_1.name);
    timer = null;
    stopped = false;
    constructor(auth, sync) {
        this.auth = auth;
        this.sync = sync;
    }
    onModuleInit() {
        const config = unasOrderSyncScheduleConfig();
        if (!config.enabled)
            return;
        this.logger.log(`UNAS order sync scheduler enabled (${config.intervalMs / 60_000} min)`);
        this.schedule(config.startupDelayMs, config.intervalMs);
    }
    onModuleDestroy() {
        this.stopped = true;
        if (this.timer)
            clearTimeout(this.timer);
        this.timer = null;
    }
    async runOnce() {
        try {
            const token = await this.auth.getToken();
            await this.sync.runIncremental(token);
            return "APPLIED";
        }
        catch (error) {
            if (error instanceof ConflictException &&
                error.message === "UNAS_ORDER_SYNC_ALREADY_RUNNING") {
                this.logger.log("UNAS order sync skipped: another run is active");
                return "SKIPPED";
            }
            const errorCode = error instanceof Error && /^[A-Z0-9_:.-]+$/.test(error.message)
                ? error.message.slice(0, 200)
                : "UNAS_ORDER_SYNC_SCHEDULED_FAILED";
            this.logger.error(`Scheduled UNAS order sync failed: ${errorCode}`);
            return "FAILED";
        }
    }
    schedule(delayMs, intervalMs) {
        this.timer = setTimeout(() => {
            void this.runOnce().finally(() => {
                if (!this.stopped)
                    this.schedule(intervalMs, intervalMs);
            });
        }, delayMs);
        this.timer.unref();
    }
};
UnasOrderSyncScheduler = UnasOrderSyncScheduler_1 = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [UnasAuthService,
        UnasOrderSyncService])
], UnasOrderSyncScheduler);
export { UnasOrderSyncScheduler };
//# sourceMappingURL=unas-order-sync.scheduler.js.map