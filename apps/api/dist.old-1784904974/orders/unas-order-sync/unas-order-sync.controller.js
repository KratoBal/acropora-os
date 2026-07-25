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
import { Controller, Get, NotFoundException, Param, Post, Query, } from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";
import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { UnasAuthService } from "../../imports/unas/unas-auth.service.js";
import { UnasOrderListQueryDto } from "./dto/unas-order-list-query.dto.js";
import { UnasOrderSyncRunsQueryDto } from "./dto/unas-order-sync-runs-query.dto.js";
import { UnasOrderSyncRepository } from "./unas-order-sync.repository.js";
import { UnasOrderSyncService } from "./unas-order-sync.service.js";
let UnasOrderSyncController = class UnasOrderSyncController {
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
    checkStockReconciliation() {
        return this.sync.checkStockReconciliation();
    }
    list(query) {
        return this.repository.list(query);
    }
    async getOne(id) {
        const order = await this.repository.findById(id);
        if (!order)
            throw new NotFoundException("A rendelés nem található.");
        return order;
    }
};
__decorate([
    Post("sync"),
    RequirePermissions(PERMISSIONS.ORDERS_MANAGE),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], UnasOrderSyncController.prototype, "run", null);
__decorate([
    Get("sync-runs/:runId"),
    RequirePermissions(PERMISSIONS.ORDERS_VIEW),
    __param(0, Param("runId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], UnasOrderSyncController.prototype, "getRun", null);
__decorate([
    Get("sync-runs"),
    RequirePermissions(PERMISSIONS.ORDERS_VIEW),
    __param(0, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [UnasOrderSyncRunsQueryDto]),
    __metadata("design:returntype", void 0)
], UnasOrderSyncController.prototype, "listRuns", null);
__decorate([
    Get("stock/reconciliation"),
    RequirePermissions(PERMISSIONS.INVENTORY_VIEW),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], UnasOrderSyncController.prototype, "checkStockReconciliation", null);
__decorate([
    Get(),
    RequirePermissions(PERMISSIONS.ORDERS_VIEW),
    __param(0, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [UnasOrderListQueryDto]),
    __metadata("design:returntype", void 0)
], UnasOrderSyncController.prototype, "list", null);
__decorate([
    Get(":id"),
    RequirePermissions(PERMISSIONS.ORDERS_VIEW),
    __param(0, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], UnasOrderSyncController.prototype, "getOne", null);
UnasOrderSyncController = __decorate([
    Controller("integrations/unas/orders"),
    __metadata("design:paramtypes", [UnasAuthService,
        UnasOrderSyncService,
        UnasOrderSyncRepository])
], UnasOrderSyncController);
export { UnasOrderSyncController };
//# sourceMappingURL=unas-order-sync.controller.js.map