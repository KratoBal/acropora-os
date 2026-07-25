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
import { CreateProductDto } from "./dto/create-product.dto.js";
import { ProductListQueryDto } from "./dto/product-list-query.dto.js";
import { UpdateProductDto } from "./dto/update-product.dto.js";
import { ProductService } from "./product.service.js";
let ProductController = class ProductController {
    products;
    constructor(products) {
        this.products = products;
    }
    listProducts(query) {
        return this.products.listProducts(query);
    }
    getProduct(id) {
        return this.products.getProduct(id);
    }
    createProduct(input, user) {
        return this.products.createProduct(input, user.id);
    }
    updateProduct(id, input) {
        return this.products.updateProduct(id, input);
    }
    archiveProduct(id) {
        return this.products.archiveProduct(id);
    }
};
__decorate([
    Get(),
    RequirePermissions(PERMISSIONS.PRODUCTS_VIEW),
    __param(0, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [ProductListQueryDto]),
    __metadata("design:returntype", void 0)
], ProductController.prototype, "listProducts", null);
__decorate([
    Get(":id"),
    RequirePermissions(PERMISSIONS.PRODUCTS_VIEW),
    __param(0, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], ProductController.prototype, "getProduct", null);
__decorate([
    Post(),
    RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE),
    __param(0, Body()),
    __param(1, CurrentUser()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [CreateProductDto, Object]),
    __metadata("design:returntype", void 0)
], ProductController.prototype, "createProduct", null);
__decorate([
    Patch(":id"),
    RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE),
    __param(0, Param("id")),
    __param(1, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, UpdateProductDto]),
    __metadata("design:returntype", void 0)
], ProductController.prototype, "updateProduct", null);
__decorate([
    Delete(":id"),
    RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE),
    __param(0, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], ProductController.prototype, "archiveProduct", null);
ProductController = __decorate([
    Controller("products"),
    __metadata("design:paramtypes", [ProductService])
], ProductController);
export { ProductController };
//# sourceMappingURL=product.controller.js.map