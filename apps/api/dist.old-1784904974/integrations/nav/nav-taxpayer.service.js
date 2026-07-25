var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { NavCredentialsService } from "./nav-credentials.service.js";
import { NavOnlineInvoiceClient } from "./nav-online-invoice.client.js";
let NavTaxpayerService = class NavTaxpayerService {
    client;
    credentials;
    constructor(client, credentials) {
        this.client = client;
        this.credentials = credentials;
    }
    async lookup(taxNumber) {
        const coreTaxNumber = taxNumber.replace(/[^0-9]/g, "").slice(0, 8);
        if (coreTaxNumber.length !== 8)
            throw new ServiceUnavailableException("NAV_TAX_NUMBER_INVALID");
        return this.client.queryTaxpayer(coreTaxNumber, this.credentials.technicalUser(), this.credentials.software());
    }
};
NavTaxpayerService = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [NavOnlineInvoiceClient,
        NavCredentialsService])
], NavTaxpayerService);
export { NavTaxpayerService };
//# sourceMappingURL=nav-taxpayer.service.js.map