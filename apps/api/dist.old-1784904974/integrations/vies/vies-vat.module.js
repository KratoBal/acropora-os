var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Module } from "@nestjs/common";
import { ViesVatClient } from "./vies-vat.client.js";
import { ViesVatController } from "./vies-vat.controller.js";
import { ViesVatService } from "./vies-vat.service.js";
let ViesVatModule = class ViesVatModule {
};
ViesVatModule = __decorate([
    Module({
        controllers: [ViesVatController],
        providers: [ViesVatClient, ViesVatService],
    })
], ViesVatModule);
export { ViesVatModule };
//# sourceMappingURL=vies-vat.module.js.map