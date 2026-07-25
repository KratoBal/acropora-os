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
import { UnasConnectionRepository } from "./unas-connection.repository.js";
import { UnasConnectionError } from "./unas-connection.types.js";
import { UnasCredentialCryptoService } from "./unas-credential-crypto.service.js";
import { UnasCredentialProvider } from "./unas-credential.provider.js";
let UnasConnectionStartupValidator = class UnasConnectionStartupValidator {
    repository;
    crypto;
    credentials;
    constructor(repository, crypto, credentials) {
        this.repository = repository;
        this.crypto = crypto;
        this.credentials = credentials;
    }
    async onModuleInit() {
        if (process.env.NODE_ENV !== "production")
            return;
        try {
            const setting = await this.repository.getSetting();
            if (!setting)
                throw new UnasConnectionError("UNAS_CONNECTION_CONFIGURATION_MISSING");
            this.crypto.validateActiveKey();
            this.credentials.validateRecord(setting);
        }
        catch (error) {
            const code = error instanceof UnasConnectionError
                ? error.code
                : "UNAS_CONNECTION_FAILED";
            throw new Error(code);
        }
    }
};
UnasConnectionStartupValidator = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [UnasConnectionRepository,
        UnasCredentialCryptoService,
        UnasCredentialProvider])
], UnasConnectionStartupValidator);
export { UnasConnectionStartupValidator };
//# sourceMappingURL=unas-connection-startup.validator.js.map