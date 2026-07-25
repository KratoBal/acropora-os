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
import { Controller, Get, Param } from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";
import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { PostalCodeService } from "./postal-code.service.js";
let PostalCodeController = class PostalCodeController {
    service;
    constructor(service) {
        this.service = service;
    }
    lookup(zip) {
        return this.service.lookupCity(zip);
    }
};
__decorate([
    Get(":zip"),
    RequirePermissions(PERMISSIONS.CUSTOMERS_MANAGE),
    __param(0, Param("zip")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], PostalCodeController.prototype, "lookup", null);
PostalCodeController = __decorate([
    Controller("integrations/postal-code"),
    __metadata("design:paramtypes", [PostalCodeService])
], PostalCodeController);
export { PostalCodeController };
//# sourceMappingURL=postal-code.controller.js.map