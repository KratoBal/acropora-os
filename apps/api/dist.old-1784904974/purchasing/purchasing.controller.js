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
import { CreatePurchaseInvoiceDto } from "./dto/create-purchase-invoice.dto.js";
import { ExchangeRateQueryDto } from "./dto/exchange-rate-query.dto.js";
import { PurchaseInvoiceListQueryDto } from "./dto/purchase-invoice-list-query.dto.js";
import { PurchaseProductSearchQueryDto } from "./dto/purchase-product-search-query.dto.js";
import { PurchasingService } from "./purchasing.service.js";
let PurchasingController = class PurchasingController {
    service;
    constructor(service) {
        this.service = service;
    }
    searchProducts(query) {
        return this.service.searchProducts(query.q);
    }
    getExchangeRate(query) {
        return this.service.getExchangeRate(query.currency, query.date);
    }
    listInvoices(query) {
        return this.service.list(query);
    }
    getInvoice(id) {
        return this.service.getDetail(id);
    }
    createInvoice(input, user) {
        return this.service.createInvoice(input, user.id);
    }
};
__decorate([
    Get("products/search"),
    RequirePermissions(PERMISSIONS.PURCHASING_VIEW),
    __param(0, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [PurchaseProductSearchQueryDto]),
    __metadata("design:returntype", void 0)
], PurchasingController.prototype, "searchProducts", null);
__decorate([
    Get("exchange-rate"),
    RequirePermissions(PERMISSIONS.PURCHASING_VIEW),
    __param(0, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [ExchangeRateQueryDto]),
    __metadata("design:returntype", void 0)
], PurchasingController.prototype, "getExchangeRate", null);
__decorate([
    Get("invoices"),
    RequirePermissions(PERMISSIONS.PURCHASING_VIEW),
    __param(0, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [PurchaseInvoiceListQueryDto]),
    __metadata("design:returntype", void 0)
], PurchasingController.prototype, "listInvoices", null);
__decorate([
    Get("invoices/:id"),
    RequirePermissions(PERMISSIONS.PURCHASING_VIEW),
    __param(0, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], PurchasingController.prototype, "getInvoice", null);
__decorate([
    Post("invoices"),
    RequirePermissions(PERMISSIONS.PURCHASING_MANAGE),
    __param(0, Body()),
    __param(1, CurrentUser()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [CreatePurchaseInvoiceDto, Object]),
    __metadata("design:returntype", void 0)
], PurchasingController.prototype, "createInvoice", null);
PurchasingController = __decorate([
    Controller("purchasing"),
    __metadata("design:paramtypes", [PurchasingService])
], PurchasingController);
export { PurchasingController };
//# sourceMappingURL=purchasing.controller.js.map