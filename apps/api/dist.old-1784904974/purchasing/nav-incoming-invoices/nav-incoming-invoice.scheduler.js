var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var NavIncomingInvoiceScheduler_1;
import { ConflictException, Injectable, Logger, } from "@nestjs/common";
import { NavIncomingInvoiceService } from "./nav-incoming-invoice.service.js";
function boundedInteger(value, fallback, minimum, maximum, errorCode) {
    if (value === undefined || value.trim() === "")
        return fallback;
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum)
        throw new Error(errorCode);
    return parsed;
}
export function navInvoiceSyncScheduleConfig(environment = process.env) {
    const enabled = environment.NAV_INVOICE_SYNC_ENABLED === "true";
    if (!enabled)
        return { enabled: false, intervalMs: 0, startupDelayMs: 0 };
    const intervalMinutes = boundedInteger(environment.NAV_INVOICE_SYNC_INTERVAL_MINUTES, 15, 1, 1440, "INVALID_NAV_INVOICE_SYNC_INTERVAL_MINUTES");
    const startupDelaySeconds = boundedInteger(environment.NAV_INVOICE_SYNC_STARTUP_DELAY_SECONDS, 30, 0, 3600, "INVALID_NAV_INVOICE_SYNC_STARTUP_DELAY_SECONDS");
    return {
        enabled,
        intervalMs: intervalMinutes * 60_000,
        startupDelayMs: startupDelaySeconds * 1000,
    };
}
let NavIncomingInvoiceScheduler = NavIncomingInvoiceScheduler_1 = class NavIncomingInvoiceScheduler {
    sync;
    logger = new Logger(NavIncomingInvoiceScheduler_1.name);
    timer = null;
    stopped = false;
    constructor(sync) {
        this.sync = sync;
    }
    onModuleInit() {
        const config = navInvoiceSyncScheduleConfig();
        if (!config.enabled)
            return;
        this.logger.log(`NAV invoice sync scheduler enabled (${config.intervalMs / 60_000} min)`);
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
            await this.sync.sync();
            return "APPLIED";
        }
        catch (error) {
            if (error instanceof ConflictException &&
                error.message === "NAV_INVOICE_SYNC_ALREADY_RUNNING") {
                this.logger.log("NAV invoice sync skipped: another run is active");
                return "SKIPPED";
            }
            const errorCode = error instanceof Error && /^[A-Z0-9_:.-]+$/.test(error.message)
                ? error.message.slice(0, 200)
                : "NAV_INVOICE_SYNC_SCHEDULED_FAILED";
            this.logger.error(`Scheduled NAV invoice sync failed: ${errorCode}`);
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
NavIncomingInvoiceScheduler = NavIncomingInvoiceScheduler_1 = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [NavIncomingInvoiceService])
], NavIncomingInvoiceScheduler);
export { NavIncomingInvoiceScheduler };
//# sourceMappingURL=nav-incoming-invoice.scheduler.js.map