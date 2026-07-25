import { type UnasCredentialEnvelope } from "./unas-connection.types.js";
export declare function validateActiveUnasMasterKey(environment?: NodeJS.ProcessEnv): void;
export declare function encryptUnasCredential(plaintext: string, revision: number, environment?: NodeJS.ProcessEnv, random?: (size: number) => Buffer): UnasCredentialEnvelope;
export declare function decryptUnasCredential(envelope: UnasCredentialEnvelope, revision: number, environment?: NodeJS.ProcessEnv): string;
export declare function validateUnasCredentialEnvelope(envelope: UnasCredentialEnvelope, revision: number, environment?: NodeJS.ProcessEnv): void;
export declare class UnasCredentialCryptoService {
    validateActiveKey(): void;
    encrypt(plaintext: string, revision: number): UnasCredentialEnvelope;
    decrypt(envelope: UnasCredentialEnvelope, revision: number): string;
    validateEnvelope(envelope: UnasCredentialEnvelope, revision: number): void;
}
