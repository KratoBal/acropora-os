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
import { UsersService } from "./users.service.js";
import { CreateUserDto, SetUserPasswordDto, UpdateUserDto, UserListQueryDto, } from "./dto/user.dto.js";
let UsersController = class UsersController {
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
    setPassword(id, input, user) {
        return this.service.setPassword(id, input, user.id);
    }
    activate(id, user) {
        return this.service.activate(id, user.id);
    }
    deactivate(id, user) {
        return this.service.deactivate(id, user.id);
    }
};
__decorate([
    Get(),
    __param(0, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [UserListQueryDto]),
    __metadata("design:returntype", void 0)
], UsersController.prototype, "list", null);
__decorate([
    Get(":id"),
    __param(0, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], UsersController.prototype, "detail", null);
__decorate([
    Post(),
    __param(0, Body()),
    __param(1, CurrentUser()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [CreateUserDto, Object]),
    __metadata("design:returntype", void 0)
], UsersController.prototype, "create", null);
__decorate([
    Patch(":id"),
    __param(0, Param("id")),
    __param(1, Body()),
    __param(2, CurrentUser()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, UpdateUserDto, Object]),
    __metadata("design:returntype", void 0)
], UsersController.prototype, "update", null);
__decorate([
    Post(":id/password"),
    __param(0, Param("id")),
    __param(1, Body()),
    __param(2, CurrentUser()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, SetUserPasswordDto, Object]),
    __metadata("design:returntype", void 0)
], UsersController.prototype, "setPassword", null);
__decorate([
    Post(":id/activate"),
    __param(0, Param("id")),
    __param(1, CurrentUser()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], UsersController.prototype, "activate", null);
__decorate([
    Post(":id/deactivate"),
    __param(0, Param("id")),
    __param(1, CurrentUser()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], UsersController.prototype, "deactivate", null);
UsersController = __decorate([
    Controller("users"),
    RequirePermissions(PERMISSIONS.USERS_MANAGE),
    __metadata("design:paramtypes", [UsersService])
], UsersController);
export { UsersController };
//# sourceMappingURL=users.controller.js.map