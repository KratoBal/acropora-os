import { Injectable } from "@nestjs/common";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import {
  UnasConnectionError,
  type UnasCredentialEnvelope,
} from "./unas-connection.types.js";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const VERSION_PATTERN = /^[1-9]\d{0,5}$/;

function aad(version: string, revision: number): Buffer {
  return Buffer.from(
    `acropora-os|integration:unas|secret:api-key|schema:1|key:${version}|revision:${revision}`,
    "utf8",
  );
}

function masterKey(version: string, environment: NodeJS.ProcessEnv): Buffer {
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

export function validateActiveUnasMasterKey(
  environment: NodeJS.ProcessEnv = process.env,
): void {
  const version = environment.UNAS_CREDENTIAL_ACTIVE_KEY_VERSION;
  if (!version || !VERSION_PATTERN.test(version))
    throw new UnasConnectionError("UNAS_CREDENTIAL_MASTER_KEY_NOT_CONFIGURED");
  const key = masterKey(version, environment);
  key.fill(0);
}

export function encryptUnasCredential(
  plaintext: string,
  revision: number,
  environment: NodeJS.ProcessEnv = process.env,
  random: (size: number) => Buffer = randomBytes,
): UnasCredentialEnvelope {
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
  } catch (error) {
    if (error instanceof UnasConnectionError) throw error;
    throw new UnasConnectionError("UNAS_CREDENTIAL_ENVELOPE_INVALID");
  } finally {
    key.fill(0);
  }
}

export function decryptUnasCredential(
  envelope: UnasCredentialEnvelope,
  revision: number,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const plaintext = decryptUnasCredentialBuffer(
    envelope,
    revision,
    environment,
  );
  try {
    return plaintext.toString("utf8");
  } finally {
    plaintext.fill(0);
  }
}

function decryptUnasCredentialBuffer(
  envelope: UnasCredentialEnvelope,
  revision: number,
  environment: NodeJS.ProcessEnv = process.env,
): Buffer {
  if (
    envelope.encryptedApiKey.length === 0 ||
    envelope.encryptionIv.length !== IV_BYTES ||
    envelope.authenticationTag.length !== TAG_BYTES
  )
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
  } catch {
    throw new UnasConnectionError("UNAS_CREDENTIAL_DECRYPT_FAILED");
  } finally {
    key.fill(0);
  }
}

export function validateUnasCredentialEnvelope(
  envelope: UnasCredentialEnvelope,
  revision: number,
  environment: NodeJS.ProcessEnv = process.env,
): void {
  const plaintext = decryptUnasCredentialBuffer(
    envelope,
    revision,
    environment,
  );
  plaintext.fill(0);
}

@Injectable()
export class UnasCredentialCryptoService {
  validateActiveKey(): void {
    validateActiveUnasMasterKey();
  }

  encrypt(plaintext: string, revision: number): UnasCredentialEnvelope {
    return encryptUnasCredential(plaintext, revision);
  }

  decrypt(envelope: UnasCredentialEnvelope, revision: number): string {
    return decryptUnasCredential(envelope, revision);
  }

  validateEnvelope(envelope: UnasCredentialEnvelope, revision: number): void {
    validateUnasCredentialEnvelope(envelope, revision);
  }
}
