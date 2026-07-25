var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Controller, Get } from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { ProductService } from "./product.service.js";
let CatalogOptionsController = class CatalogOptionsController {
    products;
    constructor(products) {
        this.products = products;
    }
    listCategoryOptions() {
        return this.products.listCategoryOptions();
    }
};
__decorate([
    Get("categories/options"),
    RequirePermissions(PERMISSIONS.PRODUCTS_VIEW),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], CatalogOptionsController.prototype, "listCategoryOptions", null);
CatalogOptionsController = __decorate([
    Controller(),
    __metadata("design:paramtypes", [ProductService])
], CatalogOptionsController);
export { CatalogOptionsController };
//# sourceMappingURL=catalog-options.controller.js.map