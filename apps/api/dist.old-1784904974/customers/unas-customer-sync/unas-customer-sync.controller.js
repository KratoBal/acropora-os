var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { Controller, Get, Param, Post, Query } from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";
import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { UnasAuthService } from "../../imports/unas/unas-auth.service.js";
import { UnasCustomerSyncRunsQueryDto } from "./dto/unas-customer-sync-runs-query.dto.js";
import { UnasCustomerSyncRepository } from "./unas-customer-sync.repository.js";
import { UnasCustomerSyncService } from "./unas-customer-sync.service.js";
let UnasCustomerSyncController = class UnasCustomerSyncController {
    auth;
    sync;
    repository;
    constructor(auth, sync, repository) {
        this.auth = auth;
        this.sync = sync;
        this.repository = repository;
    }
    async run() {
        const token = await this.auth.getToken();
        return this.sync.runIncremental(token);
    }
    getRun(runId) {
        return this.repository.getRun(runId);
    }
    listRuns(query) {
        return this.repository.listRuns(query.limit);
    }
};
__decorate([
    Post("sync"),
    RequirePermissions(PERMISSIONS.CUSTOMERS_MANAGE),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], UnasCustomerSyncController.prototype, "run", null);
__decorate([
    Get("sync-runs/:runId"),
    RequirePermissions(PERMISSIONS.CUSTOMERS_VIEW),
    __param(0, Param("runId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], UnasCustomerSyncController.prototype, "getRun", null);
__decorate([
    Get("sync-runs"),
    RequirePermissions(PERMISSIONS.CUSTOMERS_VIEW),
    __param(0, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [UnasCustomerSyncRunsQueryDto]),
    __metadata("design:returntype", void 0)
], UnasCustomerSyncController.prototype, "listRuns", null);
UnasCustomerSyncController = __decorate([
    Controller("integrations/unas/customers"),
    __metadata("design:paramtypes", [UnasAuthService,
        UnasCustomerSyncService,
        UnasCustomerSyncRepository])
], UnasCustomerSyncController);
export { UnasCustomerSyncController };
//# sourceMappingURL=unas-customer-sync.controller.js.map