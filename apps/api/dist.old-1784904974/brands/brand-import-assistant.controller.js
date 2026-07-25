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
import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { BrandImportAssistantService } from "./brand-import-assistant.service.js";
import { BrandImportRowsQueryDto, BulkCreateImportBrandsDto, CreateBrandFromImportDto, MapImportAliasDto, MapImportExternalDto, } from "./dto/brand-import-assistant.dto.js";
let BrandImportAssistantController = class BrandImportAssistantController {
    service;
    constructor(service) {
        this.service = service;
    }
    batches() {
        return this.service.batches();
    }
    summary(batchId) {
        return this.service.summary(batchId);
    }
    rows(batchId, query) {
        return this.service.rows(batchId, query);
    }
    createBrand(batchId, rowId, input, user) {
        return this.service.createBrand(batchId, rowId, input, user.id);
    }
    mapAlias(batchId, rowId, input, user) {
        return this.service.mapAlias(batchId, rowId, input, user.id);
    }
    mapExternal(batchId, rowId, input, user) {
        return this.service.mapExternal(batchId, rowId, input, user.id);
    }
    bulkCreate(batchId, input, user) {
        return this.service.bulkCreate(batchId, input, user.id);
    }
};
__decorate([
    Get("batches"),
    RequirePermissions(PERMISSIONS.PRODUCTS_VIEW),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], BrandImportAssistantController.prototype, "batches", null);
__decorate([
    Get("batches/:batchId"),
    RequirePermissions(PERMISSIONS.PRODUCTS_VIEW),
    __param(0, Param("batchId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], BrandImportAssistantController.prototype, "summary", null);
__decorate([
    Get("batches/:batchId/rows"),
    RequirePermissions(PERMISSIONS.PRODUCTS_VIEW),
    __param(0, Param("batchId")),
    __param(1, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, BrandImportRowsQueryDto]),
    __metadata("design:returntype", void 0)
], BrandImportAssistantController.prototype, "rows", null);
__decorate([
    Post("batches/:batchId/rows/:rowId/create-brand"),
    RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE),
    __param(0, Param("batchId")),
    __param(1, Param("rowId")),
    __param(2, Body()),
    __param(3, CurrentUser()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, CreateBrandFromImportDto, Object]),
    __metadata("design:returntype", void 0)
], BrandImportAssistantController.prototype, "createBrand", null);
__decorate([
    Post("batches/:batchId/rows/:rowId/map-alias"),
    RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE),
    __param(0, Param("batchId")),
    __param(1, Param("rowId")),
    __param(2, Body()),
    __param(3, CurrentUser()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, MapImportAliasDto, Object]),
    __metadata("design:returntype", void 0)
], BrandImportAssistantController.prototype, "mapAlias", null);
__decorate([
    Post("batches/:batchId/rows/:rowId/map-external"),
    RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE),
    __param(0, Param("batchId")),
    __param(1, Param("rowId")),
    __param(2, Body()),
    __param(3, CurrentUser()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, MapImportExternalDto, Object]),
    __metadata("design:returntype", void 0)
], BrandImportAssistantController.prototype, "mapExternal", null);
__decorate([
    Post("batches/:batchId/bulk-create"),
    RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE),
    __param(0, Param("batchId")),
    __param(1, Body()),
    __param(2, CurrentUser()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, BulkCreateImportBrandsDto, Object]),
    __metadata("design:returntype", void 0)
], BrandImportAssistantController.prototype, "bulkCreate", null);
BrandImportAssistantController = __decorate([
    Controller("brands/import-assistant"),
    __metadata("design:paramtypes", [BrandImportAssistantService])
], BrandImportAssistantController);
export { BrandImportAssistantController };
//# sourceMappingURL=brand-import-assistant.controller.js.map