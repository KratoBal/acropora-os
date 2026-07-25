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
import { ViesVatService } from "./vies-vat.service.js";
let ViesVatController = class ViesVatController {
    service;
    constructor(service) {
        this.service = service;
    }
    check(taxNumber) {
        return this.service.check(taxNumber);
    }
};
__decorate([
    Get("check/:taxNumber"),
    RequirePermissions(PERMISSIONS.PURCHASING_MANAGE),
    __param(0, Param("taxNumber")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], ViesVatController.prototype, "check", null);
ViesVatController = __decorate([
    Controller("integrations/vies"),
    __metadata("design:paramtypes", [ViesVatService])
], ViesVatController);
export { ViesVatController };
//# sourceMappingURL=vies-vat.controller.js.map