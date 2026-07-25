import { UnasApiClient } from "./unas-api.client.js";
import { UnasCredentialProvider } from "./unas-credential.provider.js";
import { UnasClock } from "./unas-login-expiry.js";
export declare class UnasAuthService {
    private readonly api;
    private readonly credentials;
    private readonly clock;
    private cached;
    private inFlight;
    private latestRequestedRevision;
    constructor(api: UnasApiClient, credentials: UnasCredentialProvider, clock: UnasClock);
    getToken(): Promise<string>;
    private login;
}
