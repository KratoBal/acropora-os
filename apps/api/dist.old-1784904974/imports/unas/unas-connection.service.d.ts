import { UnasApiClient } from "./unas-api.client.js";
import { UnasConnectionRepository } from "./unas-connection.repository.js";
import { type UnasConnectionView } from "./unas-connection.types.js";
import { UnasCredentialCryptoService } from "./unas-credential-crypto.service.js";
import { UnasCredentialProvider } from "./unas-credential.provider.js";
import { UnasClock } from "./unas-login-expiry.js";
export declare class UnasConnectionService {
    private readonly repository;
    private readonly crypto;
    private readonly credentials;
    private readonly api;
    private readonly clock;
    constructor(repository: UnasConnectionRepository, crypto: UnasCredentialCryptoService, credentials: UnasCredentialProvider, api: UnasApiClient, clock: UnasClock);
    get(now?: Date): Promise<UnasConnectionView>;
    replaceCredential(apiKeyInput: string, actorUserId: string, now?: Date): Promise<UnasConnectionView>;
    testStoredCredential(actorUserId: string, now?: Date): Promise<UnasConnectionView>;
    disable(actorUserId: string, now?: Date): Promise<UnasConnectionView>;
    private verify;
    private view;
}
