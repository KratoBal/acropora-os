var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Injectable, ServiceUnavailableException } from "@nestjs/common";
function requiredEnv(name) {
    const value = process.env[name]?.trim();
    if (!value)
        throw new ServiceUnavailableException("NAV_NOT_CONFIGURED");
    return value;
}
let NavCredentialsService = class NavCredentialsService {
    technicalUser() {
        return {
            login: requiredEnv("NAV_TECHNICAL_USER_LOGIN"),
            password: requiredEnv("NAV_TECHNICAL_USER_PASSWORD"),
            taxNumber: requiredEnv("NAV_TECHNICAL_USER_TAX_NUMBER"),
            signKey: requiredEnv("NAV_TECHNICAL_USER_SIGN_KEY"),
        };
    }
    software() {
        return {
            softwareId: requiredEnv("NAV_SOFTWARE_ID"),
            softwareName: process.env.NAV_SOFTWARE_NAME?.trim() || "Acropora OS",
            softwareOperation: "ONLINE_SERVICE",
            softwareMainVersion: process.env.NAV_SOFTWARE_VERSION?.trim() || "1.0",
            softwareDevName: requiredEnv("NAV_SOFTWARE_DEV_NAME"),
            softwareDevContact: requiredEnv("NAV_SOFTWARE_DEV_CONTACT"),
            softwareDevCountryCode: process.env.NAV_SOFTWARE_DEV_COUNTRY_CODE?.trim() || "HU",
            softwareDevTaxNumber: requiredEnv("NAV_SOFTWARE_DEV_TAX_NUMBER"),
        };
    }
};
NavCredentialsService = __decorate([
    Injectable()
], NavCredentialsService);
export { NavCredentialsService };
//# sourceMappingURL=nav-credentials.service.js.map