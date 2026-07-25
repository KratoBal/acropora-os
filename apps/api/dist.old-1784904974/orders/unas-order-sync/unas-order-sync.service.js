var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Injectable } from "@nestjs/common";
import { UnasApiClient } from "../../imports/unas/unas-api.client.js";
import { UnasOrderSyncRepository } from "./unas-order-sync.repository.js";
const OVERLAP_MS = 120_000;
const DEFAULT_PAGE_SIZE = 500;
let UnasOrderSyncService = class UnasOrderSyncService {
    api;
    repository;
    constructor(api, repository) {
        this.api = api;
        this.repository = repository;
    }
    async runIncremental(token, windowEnd = new Date(), pageSize = DEFAULT_PAGE_SIZE) {
        const cursor = await this.repository.getCursor();
        const windowStart = cursor
            ? new Date(cursor.getTime() - OVERLAP_MS)
            : null;
        const runId = await this.repository.createRun({ windowStart, windowEnd });
        try {
            const orders = await this.downloadOrders(token, windowStart, windowEnd, pageSize);
            const summary = await this.repository.apply(runId, orders, windowStart, windowEnd);
            const reconciliation = await this.repository.findStockDiscrepancies();
            await this.repository.recordStockMismatchCount(runId, reconciliation.mismatches.length);
            return { ...summary, stockMismatchCount: reconciliation.mismatches.length };
        }
        catch (error) {
            const errorCode = error instanceof Error ? error.message : "UNAS_ORDER_SYNC_FAILED";
            await this.repository.markFailed(runId, errorCode);
            throw error;
        }
    }
    checkStockReconciliation() {
        return this.repository.findStockDiscrepancies();
    }
    async downloadOrders(token, windowStart, windowEnd, pageSize) {
        const byKey = new Map();
        for (let limitStart = 0;; limitStart += pageSize) {
            const page = await this.api.getOrderPage(token, {
                timeModStart: windowStart
                    ? Math.floor(windowStart.getTime() / 1000)
                    : undefined,
                timeModEnd: Math.floor(windowEnd.getTime() / 1000),
                limitStart,
                limitNum: pageSize,
            });
            for (const order of page)
                byKey.set(order.key, order);
            if (page.length < pageSize)
                break;
        }
        return [...byKey.values()];
    }
};
UnasOrderSyncService = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [UnasApiClient,
        UnasOrderSyncRepository])
], UnasOrderSyncService);
export { UnasOrderSyncService };
//# sourceMappingURL=unas-order-sync.service.js.map