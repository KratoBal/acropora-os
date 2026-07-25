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
import { NavIncomingInvoiceListQueryDto } from "./dto/nav-incoming-invoice-list-query.dto.js";
import { NavInvoiceSyncRunsQueryDto } from "./dto/nav-invoice-sync-runs-query.dto.js";
import { NavIncomingInvoiceRepository } from "./nav-incoming-invoice.repository.js";
import { NavIncomingInvoiceService } from "./nav-incoming-invoice.service.js";
let NavIncomingInvoiceController = class NavIncomingInvoiceController {
    service;
    repository;
    constructor(service, repository) {
        this.service = service;
        this.repository = repository;
    }
    list(query) {
        return this.service.list(query);
    }
    detail(id) {
        return this.service.detail(id);
    }
    sync() {
        return this.service.sync();
    }
    getRun(runId) {
        return this.repository.getRun(runId);
    }
    listRuns(query) {
        return this.repository.listRuns(query.limit);
    }
};
__decorate([
    Get(),
    RequirePermissions(PERMISSIONS.PURCHASING_VIEW),
    __param(0, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [NavIncomingInvoiceListQueryDto]),
    __metadata("design:returntype", void 0)
], NavIncomingInvoiceController.prototype, "list", null);
__decorate([
    Get(":id"),
    RequirePermissions(PERMISSIONS.PURCHASING_VIEW),
    __param(0, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], NavIncomingInvoiceController.prototype, "detail", null);
__decorate([
    Post("sync"),
    RequirePermissions(PERMISSIONS.PURCHASING_MANAGE),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], NavIncomingInvoiceController.prototype, "sync", null);
__decorate([
    Get("sync-runs/:runId"),
    RequirePermissions(PERMISSIONS.PURCHASING_VIEW),
    __param(0, Param("runId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], NavIncomingInvoiceController.prototype, "getRun", null);
__decorate([
    Get("sync-runs"),
    RequirePermissions(PERMISSIONS.PURCHASING_VIEW),
    __param(0, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [NavInvoiceSyncRunsQueryDto]),
    __metadata("design:returntype", void 0)
], NavIncomingInvoiceController.prototype, "listRuns", null);
NavIncomingInvoiceController = __decorate([
    Controller("integrations/nav/invoices"),
    __metadata("design:paramtypes", [NavIncomingInvoiceService,
        NavIncomingInvoiceRepository])
], NavIncomingInvoiceController);
export { NavIncomingInvoiceController };
//# sourceMappingURL=nav-incoming-invoice.controller.js.map