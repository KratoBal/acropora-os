var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Module } from "@nestjs/common";
import { NavCredentialsService } from "./nav-credentials.service.js";
import { NavOnlineInvoiceClient } from "./nav-online-invoice.client.js";
import { NavTaxpayerController } from "./nav-taxpayer.controller.js";
import { NavTaxpayerService } from "./nav-taxpayer.service.js";
let NavOnlineInvoiceModule = class NavOnlineInvoiceModule {
};
NavOnlineInvoiceModule = __decorate([
    Module({
        controllers: [NavTaxpayerController],
        providers: [
            NavOnlineInvoiceClient,
            NavCredentialsService,
            NavTaxpayerService,
        ],
        exports: [NavOnlineInvoiceClient, NavCredentialsService],
    })
], NavOnlineInvoiceModule);
export { NavOnlineInvoiceModule };
//# sourceMappingURL=nav-online-invoice.module.js.map