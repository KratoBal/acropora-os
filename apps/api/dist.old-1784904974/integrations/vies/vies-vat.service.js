var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Injectable } from "@nestjs/common";
import { ViesApiError, ViesVatClient } from "./vies-vat.client.js";
const VAT_FORMAT = /^([A-Z]{2})([0-9A-Z+*.]{2,12})$/;
let ViesVatService = class ViesVatService {
    client;
    constructor(client) {
        this.client = client;
    }
    async check(rawTaxNumber) {
        const normalized = rawTaxNumber.trim().replace(/\s+/g, "").toUpperCase();
        const match = VAT_FORMAT.exec(normalized);
        if (!match)
            return {
                message: "Az adószám nem felel meg az EU-s közösségi adószám formátumának (pl. DE123456789).",
            };
        const countryCode = match[1];
        const vatNumber = match[2];
        try {
            const result = await this.client.checkVat(countryCode, vatNumber);
            return {
                valid: result.valid,
                name: result.name,
                address: result.address,
            };
        }
        catch (error) {
            return { message: this.mapError(error) };
        }
    }
    mapError(error) {
        if (error instanceof ViesApiError) {
            switch (error.code) {
                case "VAT_NUMBER_INVALID":
                    return "A VIES szerint az adószám formátuma érvénytelen.";
                case "MS_UNAVAILABLE":
                    return "Az adott tagállam VIES-szolgáltatása jelenleg nem érhető el, próbáld később.";
                default:
                    return "A VIES adószám-ellenőrző szolgáltatás jelenleg nem érhető el, próbáld később.";
            }
        }
        return "A VIES adószám-ellenőrző szolgáltatás jelenleg nem érhető el, próbáld később.";
    }
};
ViesVatService = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [ViesVatClient])
], ViesVatService);
export { ViesVatService };
//# sourceMappingURL=vies-vat.service.js.map