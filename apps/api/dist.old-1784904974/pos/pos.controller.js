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
import { CreatePosSaleDto } from "./dto/create-pos-sale.dto.js";
import { PosProductSearchQueryDto } from "./dto/pos-product-search-query.dto.js";
import { PosSaleListQueryDto } from "./dto/pos-sale-list-query.dto.js";
import { PosProductSearchService } from "./pos-product-search.service.js";
import { PosSaleService } from "./pos-sale.service.js";
let PosController = class PosController {
    search;
    sales;
    constructor(search, sales) {
        this.search = search;
        this.sales = sales;
    }
    searchProducts(query) {
        return this.search.search(query.q);
    }
    listSales(query) {
        return this.sales.list(query);
    }
    getSale(id) {
        return this.sales.getDetail(id);
    }
    createSale(dto, user) {
        return this.sales.createSale(dto, user.id);
    }
};
__decorate([
    Get("products"),
    RequirePermissions(PERMISSIONS.ORDERS_VIEW),
    __param(0, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [PosProductSearchQueryDto]),
    __metadata("design:returntype", void 0)
], PosController.prototype, "searchProducts", null);
__decorate([
    Get("sales"),
    RequirePermissions(PERMISSIONS.ORDERS_VIEW),
    __param(0, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [PosSaleListQueryDto]),
    __metadata("design:returntype", void 0)
], PosController.prototype, "listSales", null);
__decorate([
    Get("sales/:id"),
    RequirePermissions(PERMISSIONS.ORDERS_VIEW),
    __param(0, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], PosController.prototype, "getSale", null);
__decorate([
    Post("sales"),
    RequirePermissions(PERMISSIONS.ORDERS_MANAGE),
    __param(0, Body()),
    __param(1, CurrentUser()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [CreatePosSaleDto, Object]),
    __metadata("design:returntype", void 0)
], PosController.prototype, "createSale", null);
PosController = __decorate([
    Controller("pos"),
    __metadata("design:paramtypes", [PosProductSearchService,
        PosSaleService])
], PosController);
export { PosController };
//# sourceMappingURL=pos.controller.js.map