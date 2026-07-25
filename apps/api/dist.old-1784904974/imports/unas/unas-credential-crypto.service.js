var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Injectable } from "@nestjs/common";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { UnasConnectionError, } from "./unas-connection.types.js";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const VERSION_PATTERN = /^[1-9]\d{0,5}$/;
function aad(version, revision) {
    return Buffer.from(`acropora-os|integration:unas|secret:api-key|schema:1|key:${version}|revision:${revision}`, "utf8");
}
function masterKey(version, environment) {
    if (!VERSION_PATTERN.test(version))
        throw new UnasConnectionError("UNAS_CREDENTIAL_KEY_VERSION_UNKNOWN");
    const encoded = environment[`UNAS_CREDENTIAL_MASTER_KEY_V${version}`];
    if (!encoded)
        throw new UnasConnectionError("UNAS_CREDENTIAL_MASTER_KEY_NOT_CONFIGURED");
    if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
        throw new UnasConnectionError("UNAS_CREDENTIAL_MASTER_KEY_INVALID");
    const decoded = Buffer.from(encoded, "base64");
    if (decoded.length !== KEY_BYTES || decoded.toString("base64") !== encoded) {
        decoded.fill(0);
        throw new UnasConnectionError("UNAS_CREDENTIAL_MASTER_KEY_INVALID");
    }
    return decoded;
}
export function validateActiveUnasMasterKey(environment = process.env) {
    const version = environment.UNAS_CREDENTIAL_ACTIVE_KEY_VERSION;
    if (!version || !VERSION_PATTERN.test(version))
        throw new UnasConnectionError("UNAS_CREDENTIAL_MASTER_KEY_NOT_CONFIGURED");
    const key = masterKey(version, environment);
    key.fill(0);
}
export function encryptUnasCredential(plaintext, revision, environment = process.env, random = randomBytes) {
    const version = environment.UNAS_CREDENTIAL_ACTIVE_KEY_VERSION;
    if (!version || !VERSION_PATTERN.test(version))
        throw new UnasConnectionError("UNAS_CREDENTIAL_MASTER_KEY_NOT_CONFIGURED");
    const key = masterKey(version, environment);
    try {
        const iv = random(IV_BYTES);
        if (iv.length !== IV_BYTES)
            throw new UnasConnectionError("UNAS_CREDENTIAL_ENVELOPE_INVALID");
        const cipher = createCipheriv(ALGORITHM, key, iv, {
            authTagLength: TAG_BYTES,
        });
        cipher.setAAD(aad(version, revision));
        const encryptedApiKey = Buffer.concat([
            cipher.update(plaintext, "utf8"),
            cipher.final(),
        ]);
        return {
            encryptedApiKey,
            encryptionIv: iv,
            authenticationTag: cipher.getAuthTag(),
            keyVersion: version,
        };
    }
    catch (error) {
        if (error instanceof UnasConnectionError)
            throw error;
        throw new UnasConnectionError("UNAS_CREDENTIAL_ENVELOPE_INVALID");
    }
    finally {
        key.fill(0);
    }
}
export function decryptUnasCredential(envelope, revision, environment = process.env) {
    const plaintext = decryptUnasCredentialBuffer(envelope, revision, environment);
    try {
        return plaintext.toString("utf8");
    }
    finally {
        plaintext.fill(0);
    }
}
function decryptUnasCredentialBuffer(envelope, revision, environment = process.env) {
    if (envelope.encryptedApiKey.length === 0 ||
        envelope.encryptionIv.length !== IV_BYTES ||
        envelope.authenticationTag.length !== TAG_BYTES)
        throw new UnasConnectionError("UNAS_CREDENTIAL_ENVELOPE_INVALID");
    const key = masterKey(envelope.keyVersion, environment);
    try {
        const decipher = createDecipheriv(ALGORITHM, key, envelope.encryptionIv, {
            authTagLength: TAG_BYTES,
        });
        decipher.setAAD(aad(envelope.keyVersion, revision));
        decipher.setAuthTag(envelope.authenticationTag);
        return Buffer.concat([
            decipher.update(envelope.encryptedApiKey),
            decipher.final(),
        ]);
    }
    catch {
        throw new UnasConnectionError("UNAS_CREDENTIAL_DECRYPT_FAILED");
    }
    finally {
        key.fill(0);
    }
}
export function validateUnasCredentialEnvelope(envelope, revision, environment = process.env) {
    const plaintext = decryptUnasCredentialBuffer(envelope, revision, environment);
    plaintext.fill(0);
}
let UnasCredentialCryptoService = class UnasCredentialCryptoService {
    validateActiveKey() {
        validateActiveUnasMasterKey();
    }
    encrypt(plaintext, revision) {
        return encryptUnasCredential(plaintext, revision);
    }
    decrypt(envelope, revision) {
        return decryptUnasCredential(envelope, revision);
    }
    validateEnvelope(envelope, revision) {
        validateUnasCredentialEnvelope(envelope, revision);
    }
};
UnasCredentialCryptoService = __decorate([
    Injectable()
], UnasCredentialCryptoService);
export { UnasCredentialCryptoService };
//# sourceMappingURL=unas-credential-crypto.service.js.map