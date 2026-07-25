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
import { UnasApiClient, UnasApiError } from "./unas-api.client.js";
import { UnasConnectionError } from "./unas-connection.types.js";
import { UnasCredentialProvider, } from "./unas-credential.provider.js";
import { assertValidUnasLoginExpiry, UnasClock, UNAS_TOKEN_MIN_REMAINING_MS, } from "./unas-login-expiry.js";
const REFRESH_MARGIN_MS = UNAS_TOKEN_MIN_REMAINING_MS;
let UnasAuthService = class UnasAuthService {
    api;
    credentials;
    clock;
    cached = null;
    inFlight = null;
    latestRequestedRevision = null;
    constructor(api, credentials, clock) {
        this.api = api;
        this.credentials = credentials;
        this.clock = clock;
    }
    async getToken() {
        let credential;
        try {
            credential = await this.credentials.resolve();
        }
        catch (error) {
            const code = error instanceof UnasConnectionError
                ? error.code
                : "UNAS_CONNECTION_FAILED";
            throw new ServiceUnavailableException(code);
        }
        if (this.cached?.credentialRevision === credential.revision &&
            this.clock.nowMs() < this.cached.expiresAtMs - REFRESH_MARGIN_MS)
            return this.cached.token;
        if (this.inFlight?.revision === credential.revision)
            return this.inFlight.promise;
        this.latestRequestedRevision = credential.revision;
        const promise = this.login(credential).finally(() => {
            if (this.inFlight?.promise === promise)
                this.inFlight = null;
        });
        this.inFlight = { revision: credential.revision, promise };
        return promise;
    }
    async login(credential) {
        let result;
        try {
            result = await this.api.login(credential.apiKey);
            assertValidUnasLoginExpiry(result.expireTime, this.clock.nowMs());
        }
        catch (error) {
            const code = error instanceof UnasApiError
                ? `UNAS_AUTH_${error.code}`
                : "UNAS_CONNECTION_FAILED";
            throw new ServiceUnavailableException(code);
        }
        if (this.latestRequestedRevision === credential.revision)
            this.cached = {
                token: result.token,
                expiresAtMs: result.expireTime * 1000,
                credentialRevision: credential.revision,
            };
        return result.token;
    }
};
UnasAuthService = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [UnasApiClient,
        UnasCredentialProvider,
        UnasClock])
], UnasAuthService);
export { UnasAuthService };
//# sourceMappingURL=unas-auth.service.js.map