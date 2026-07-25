var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { ForbiddenException, Injectable, } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { hasAllPermissions } from "@acropora/types";
import { REQUIRED_PERMISSIONS_KEY } from "../decorators/require-permissions.decorator.js";
let PermissionGuard = class PermissionGuard {
    reflector;
    constructor(reflector) {
        this.reflector = reflector;
    }
    canActivate(context) {
        const permissions = this.reflector.getAllAndOverride(REQUIRED_PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);
        if (!permissions?.length)
            return true;
        const user = context.switchToHttp().getRequest().user;
        if (!user || !hasAllPermissions(user, permissions)) {
            throw new ForbiddenException("Nincs jogosultságod ehhez a művelethez.");
        }
        return true;
    }
};
PermissionGuard = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [Reflector])
], PermissionGuard);
export { PermissionGuard };
//# sourceMappingURL=permission.guard.js.map