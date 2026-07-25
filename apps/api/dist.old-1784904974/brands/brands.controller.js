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
import { Body, Controller, Delete, Get, Param, Patch, Post, Query, } from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { ProductService } from "../products/product.service.js";
import { BrandsService } from "./brands.service.js";
import { BrandAliasDto, BrandListQueryDto, CreateBrandDto, UpdateBrandDto, } from "./dto/brand.dto.js";
let BrandsController = class BrandsController {
    service;
    products;
    constructor(service, products) {
        this.service = service;
        this.products = products;
    }
    list(query) {
        return this.service.list(query);
    }
    options() {
        return this.products.listBrandOptions();
    }
    detail(id) {
        return this.service.detail(id);
    }
    create(input, user) {
        return this.service.create(input, user.id);
    }
    update(id, input, user) {
        return this.service.update(id, input, user.id);
    }
    archive(id, user) {
        return this.service.archive(id, user.id);
    }
    restore(id, user) {
        return this.service.restore(id, user.id);
    }
    addAlias(id, input, user) {
        return this.service.addAlias(id, input, user.id);
    }
    updateAlias(id, aliasId, input, user) {
        return this.service.updateAlias(id, aliasId, input, user.id);
    }
    removeAlias(id, aliasId, user) {
        return this.service.removeAlias(id, aliasId, user.id);
    }
};
__decorate([
    Get(),
    RequirePermissions(PERMISSIONS.PRODUCTS_VIEW),
    __param(0, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [BrandListQueryDto]),
    __metadata("design:returntype", void 0)
], BrandsController.prototype, "list", null);
__decorate([
    Get("options"),
    RequirePermissions(PERMISSIONS.PRODUCTS_VIEW),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], BrandsController.prototype, "options", null);
__decorate([
    Get(":id"),
    RequirePermissions(PERMISSIONS.PRODUCTS_VIEW),
    __param(0, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], BrandsController.prototype, "detail", null);
__decorate([
    Post(),
    RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE),
    __param(0, Body()),
    __param(1, CurrentUser()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [CreateBrandDto, Object]),
    __metadata("design:returntype", void 0)
], BrandsController.prototype, "create", null);
__decorate([
    Patch(":id"),
    RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE),
    __param(0, Param("id")),
    __param(1, Body()),
    __param(2, CurrentUser()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, UpdateBrandDto, Object]),
    __metadata("design:returntype", void 0)
], BrandsController.prototype, "update", null);
__decorate([
    Post(":id/archive"),
    RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE),
    __param(0, Param("id")),
    __param(1, CurrentUser()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], BrandsController.prototype, "archive", null);
__decorate([
    Post(":id/restore"),
    RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE),
    __param(0, Param("id")),
    __param(1, CurrentUser()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], BrandsController.prototype, "restore", null);
__decorate([
    Post(":id/aliases"),
    RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE),
    __param(0, Param("id")),
    __param(1, Body()),
    __param(2, CurrentUser()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, BrandAliasDto, Object]),
    __metadata("design:returntype", void 0)
], BrandsController.prototype, "addAlias", null);
__decorate([
    Patch(":id/aliases/:aliasId"),
    RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE),
    __param(0, Param("id")),
    __param(1, Param("aliasId")),
    __param(2, Body()),
    __param(3, CurrentUser()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, BrandAliasDto, Object]),
    __metadata("design:returntype", void 0)
], BrandsController.prototype, "updateAlias", null);
__decorate([
    Delete(":id/aliases/:aliasId"),
    RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE),
    __param(0, Param("id")),
    __param(1, Param("aliasId")),
    __param(2, CurrentUser()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", void 0)
], BrandsController.prototype, "removeAlias", null);
BrandsController = __decorate([
    Controller("brands"),
    __metadata("design:paramtypes", [BrandsService,
        ProductService])
], BrandsController);
export { BrandsController };
//# sourceMappingURL=brands.controller.js.map