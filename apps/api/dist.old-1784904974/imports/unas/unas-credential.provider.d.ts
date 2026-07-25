import { UnasConnectionRepository } from "./unas-connection.repository.js";
import { type UnasConnectionSettingRecord } from "./unas-connection.types.js";
import { UnasCredentialCryptoService } from "./unas-credential-crypto.service.js";
export interface ResolvedUnasCredential {
    apiKey: string;
    revision: string;
}
export declare class UnasCredentialProvider {
    private readonly repository;
    private readonly crypto;
    constructor(repository: UnasConnectionRepository, crypto: UnasCredentialCryptoService);
    resolve(): Promise<ResolvedUnasCredential>;
    resolveRecord(setting: UnasConnectionSettingRecord): ResolvedUnasCredential;
    validateRecord(setting: UnasConnectionSettingRecord): void;
    private environmentCredential;
    private databaseCredential;
    private databaseEnvelope;
}
