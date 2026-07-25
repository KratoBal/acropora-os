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
import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { CustomersService } from "./customers.service.js";
import { CreateCustomerDto, CustomerListQueryDto, UpdateCustomerDto, } from "./dto/customer.dto.js";
let CustomersController = class CustomersController {
    service;
    constructor(service) {
        this.service = service;
    }
    list(query) {
        return this.service.list(query);
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
};
__decorate([
    Get(),
    RequirePermissions(PERMISSIONS.CUSTOMERS_VIEW),
    __param(0, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [CustomerListQueryDto]),
    __metadata("design:returntype", void 0)
], CustomersController.prototype, "list", null);
__decorate([
    Get(":id"),
    RequirePermissions(PERMISSIONS.CUSTOMERS_VIEW),
    __param(0, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], CustomersController.prototype, "detail", null);
__decorate([
    Post(),
    RequirePermissions(PERMISSIONS.CUSTOMERS_MANAGE),
    __param(0, Body()),
    __param(1, CurrentUser()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [CreateCustomerDto, Object]),
    __metadata("design:returntype", void 0)
], CustomersController.prototype, "create", null);
__decorate([
    Patch(":id"),
    RequirePermissions(PERMISSIONS.CUSTOMERS_MANAGE),
    __param(0, Param("id")),
    __param(1, Body()),
    __param(2, CurrentUser()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, UpdateCustomerDto, Object]),
    __metadata("design:returntype", void 0)
], CustomersController.prototype, "update", null);
CustomersController = __decorate([
    Controller("customers"),
    __metadata("design:paramtypes", [CustomersService])
], CustomersController);
export { CustomersController };
//# sourceMappingURL=customers.controller.js.map