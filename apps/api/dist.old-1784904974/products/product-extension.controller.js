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
import { Body, Controller, Get, Param, Put } from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { UpsertProductExtensionDto } from "./dto/upsert-product-extension.dto.js";
import { ProductExtensionService } from "./product-extension.service.js";
let ProductExtensionController = class ProductExtensionController {
    extensions;
    constructor(extensions) {
        this.extensions = extensions;
    }
    getByVariantId(variantId) {
        return this.extensions.getByVariantId(variantId);
    }
    upsert(variantId, input, user) {
        return this.extensions.upsert(variantId, input, user.id);
    }
};
__decorate([
    Get(":variantId"),
    RequirePermissions(PERMISSIONS.PRODUCTS_VIEW),
    __param(0, Param("variantId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], ProductExtensionController.prototype, "getByVariantId", null);
__decorate([
    Put(":variantId"),
    RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE),
    __param(0, Param("variantId")),
    __param(1, Body()),
    __param(2, CurrentUser()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, UpsertProductExtensionDto, Object]),
    __metadata("design:returntype", void 0)
], ProductExtensionController.prototype, "upsert", null);
ProductExtensionController = __decorate([
    Controller("product-extensions"),
    __metadata("design:paramtypes", [ProductExtensionService])
], ProductExtensionController);
export { ProductExtensionController };
//# sourceMappingURL=product-extension.controller.js.map