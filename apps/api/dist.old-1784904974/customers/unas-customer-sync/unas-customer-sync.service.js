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
import { UnasCustomerSyncRepository } from "./unas-customer-sync.repository.js";
const OVERLAP_MS = 120_000;
const DEFAULT_PAGE_SIZE = 100;
let UnasCustomerSyncService = class UnasCustomerSyncService {
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
            const customers = await this.downloadCustomers(token, windowStart, windowEnd, pageSize);
            return await this.repository.apply(runId, customers, windowStart, windowEnd);
        }
        catch (error) {
            const errorCode = error instanceof Error ? error.message : "UNAS_CUSTOMER_SYNC_FAILED";
            await this.repository.markFailed(runId, errorCode);
            throw error;
        }
    }
    async downloadCustomers(token, windowStart, windowEnd, pageSize) {
        const byExternalId = new Map();
        for (let limitStart = 0;; limitStart += pageSize) {
            const page = await this.api.getCustomerPage(token, {
                modTimeStart: windowStart
                    ? Math.floor(windowStart.getTime() / 1000)
                    : undefined,
                modTimeEnd: Math.floor(windowEnd.getTime() / 1000),
                limitStart,
                limitNum: pageSize,
            });
            for (const customer of page)
                byExternalId.set(customer.externalId, customer);
            if (page.length < pageSize)
                break;
        }
        return [...byExternalId.values()];
    }
};
UnasCustomerSyncService = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [UnasApiClient,
        UnasCustomerSyncRepository])
], UnasCustomerSyncService);
export { UnasCustomerSyncService };
//# sourceMappingURL=unas-customer-sync.service.js.map