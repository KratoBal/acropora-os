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
import { Body, Controller, Delete, Get, HttpException, HttpStatus, Post, Put, } from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";
import { CurrentUser } from "../../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { UnasConnectionService } from "./unas-connection.service.js";
function candidateApiKey(body) {
    if (!body || typeof body !== "object" || Array.isArray(body))
        throw new HttpException("UNAS_CREDENTIAL_INPUT_INVALID", HttpStatus.BAD_REQUEST);
    const keys = Object.keys(body);
    const apiKey = body.apiKey;
    if (keys.length !== 1 ||
        keys[0] !== "apiKey" ||
        typeof apiKey !== "string" ||
        apiKey.trim().length === 0 ||
        apiKey.length > 4096)
        throw new HttpException("UNAS_CREDENTIAL_INPUT_INVALID", HttpStatus.BAD_REQUEST);
    return apiKey;
}
let UnasConnectionController = class UnasConnectionController {
    service;
    constructor(service) {
        this.service = service;
    }
    get() {
        return this.service.get();
    }
    replaceCredential(input, user) {
        return this.service.replaceCredential(candidateApiKey(input), user.id);
    }
    testStoredCredential(user) {
        return this.service.testStoredCredential(user.id);
    }
    disable(user) {
        return this.service.disable(user.id);
    }
};
__decorate([
    Get(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], UnasConnectionController.prototype, "get", null);
__decorate([
    Put("credential"),
    __param(0, Body()),
    __param(1, CurrentUser()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], UnasConnectionController.prototype, "replaceCredential", null);
__decorate([
    Post("test"),
    __param(0, CurrentUser()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], UnasConnectionController.prototype, "testStoredCredential", null);
__decorate([
    Delete("credential"),
    __param(0, CurrentUser()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], UnasConnectionController.prototype, "disable", null);
UnasConnectionController = __decorate([
    Controller("integrations/unas/connection"),
    RequirePermissions(PERMISSIONS.SETTINGS_MANAGE),
    __metadata("design:paramtypes", [UnasConnectionService])
], UnasConnectionController);
export { UnasConnectionController };
//# sourceMappingURL=unas-connection.controller.js.map