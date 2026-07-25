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
import { createHash } from "node:crypto";
import { UnasConnectionRepository } from "./unas-connection.repository.js";
import { UnasConnectionError, } from "./unas-connection.types.js";
import { UnasCredentialCryptoService } from "./unas-credential-crypto.service.js";
let UnasCredentialProvider = class UnasCredentialProvider {
    repository;
    crypto;
    constructor(repository, crypto) {
        this.repository = repository;
        this.crypto = crypto;
    }
    async resolve() {
        const setting = await this.repository.getSetting();
        if (!setting)
            throw new UnasConnectionError("UNAS_CONNECTION_CONFIGURATION_MISSING");
        return this.resolveRecord(setting);
    }
    resolveRecord(setting) {
        if (setting.credentialMode === "ENV_FALLBACK")
            return this.environmentCredential();
        if (setting.credentialMode === "DISABLED")
            throw new UnasConnectionError("UNAS_CONNECTION_DISABLED");
        return this.databaseCredential(setting);
    }
    validateRecord(setting) {
        if (setting.credentialMode === "ENV_FALLBACK") {
            if (!process.env.UNAS_API_KEY?.trim())
                throw new UnasConnectionError("UNAS_CONNECTION_NOT_CONFIGURED");
            return;
        }
        if (setting.credentialMode === "DISABLED")
            return;
        const envelope = this.databaseEnvelope(setting);
        this.crypto.validateEnvelope(envelope, setting.credentialRevision);
    }
    environmentCredential() {
        const apiKey = process.env.UNAS_API_KEY?.trim();
        if (!apiKey)
            throw new UnasConnectionError("UNAS_CONNECTION_NOT_CONFIGURED");
        const digest = createHash("sha256").update(apiKey).digest("hex");
        return { apiKey, revision: `env:${digest}` };
    }
    databaseCredential(setting) {
        const envelope = this.databaseEnvelope(setting);
        try {
            return {
                apiKey: this.crypto.decrypt(envelope, setting.credentialRevision),
                revision: `database:${setting.credentialRevision}`,
            };
        }
        catch (error) {
            if (error instanceof UnasConnectionError)
                throw error;
            throw new UnasConnectionError("UNAS_CREDENTIAL_DECRYPT_FAILED");
        }
    }
    databaseEnvelope(setting) {
        if (!setting.encryptedApiKey ||
            !setting.encryptionIv ||
            !setting.authenticationTag ||
            !setting.keyVersion)
            throw new UnasConnectionError("UNAS_CREDENTIAL_ENVELOPE_INVALID");
        const envelope = {
            encryptedApiKey: Buffer.from(setting.encryptedApiKey),
            encryptionIv: Buffer.from(setting.encryptionIv),
            authenticationTag: Buffer.from(setting.authenticationTag),
            keyVersion: setting.keyVersion,
        };
        return envelope;
    }
};
UnasCredentialProvider = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [UnasConnectionRepository,
        UnasCredentialCryptoService])
], UnasCredentialProvider);
export { UnasCredentialProvider };
//# sourceMappingURL=unas-credential.provider.js.map