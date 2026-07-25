import { type OnModuleInit } from "@nestjs/common";
import { UnasConnectionRepository } from "./unas-connection.repository.js";
import { UnasCredentialCryptoService } from "./unas-credential-crypto.service.js";
import { UnasCredentialProvider } from "./unas-credential.provider.js";
export declare class UnasConnectionStartupValidator implements OnModuleInit {
    private readonly repository;
    private readonly crypto;
    private readonly credentials;
    constructor(repository: UnasConnectionRepository, crypto: UnasCredentialCryptoService, credentials: UnasCredentialProvider);
    onModuleInit(): Promise<void>;
}
