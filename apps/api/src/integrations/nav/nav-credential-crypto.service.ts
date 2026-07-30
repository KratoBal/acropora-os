import { Injectable } from "@nestjs/common";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import {
  NavConnectionError,
  type NavCredentialEnvelope,
} from "./nav-connection.types.js";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const VERSION_PATTERN = /^[1-9]\d{0,5}$/;

function aad(version: string, revision: number): Buffer {
  return Buffer.from(
    `acropora-os|integration:nav|secret:credentials|schema:1|key:${version}|revision:${revision}`,
    "utf8",
  );
}

function masterKey(version: string, environment: NodeJS.ProcessEnv): Buffer {
  if (!VERSION_PATTERN.test(version))
    throw new NavConnectionError("NAV_CREDENTIAL_KEY_VERSION_UNKNOWN");
  const encoded = environment[`NAV_CREDENTIAL_MASTER_KEY_V${version}`];
  if (!encoded)
    throw new NavConnectionError("NAV_CREDENTIAL_MASTER_KEY_NOT_CONFIGURED");
  if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
    throw new NavConnectionError("NAV_CREDENTIAL_MASTER_KEY_INVALID");
  const decoded = Buffer.from(encoded, "base64");
  if (decoded.length !== KEY_BYTES || decoded.toString("base64") !== encoded) {
    decoded.fill(0);
    throw new NavConnectionError("NAV_CREDENTIAL_MASTER_KEY_INVALID");
  }
  return decoded;
}

function activeVersion(environment: NodeJS.ProcessEnv): string {
  const version = environment.NAV_CREDENTIAL_ACTIVE_KEY_VERSION;
  if (!version || !VERSION_PATTERN.test(version))
    throw new NavConnectionError("NAV_CREDENTIAL_MASTER_KEY_NOT_CONFIGURED");
  return version;
}

export function encryptNavCredentials(
  plaintext: string,
  revision: number,
  environment: NodeJS.ProcessEnv = process.env,
  random: (size: number) => Buffer = randomBytes,
): NavCredentialEnvelope {
  const version = activeVersion(environment);
  const key = masterKey(version, environment);
  try {
    const iv = random(IV_BYTES);
    if (iv.length !== IV_BYTES)
      throw new NavConnectionError("NAV_CREDENTIAL_ENVELOPE_INVALID");
    const cipher = createCipheriv(ALGORITHM, key, iv, {
      authTagLength: TAG_BYTES,
    });
    cipher.setAAD(aad(version, revision));
    return {
      encryptedCredentials: Buffer.concat([
        cipher.update(plaintext, "utf8"),
        cipher.final(),
      ]),
      encryptionIv: iv,
      authenticationTag: cipher.getAuthTag(),
      keyVersion: version,
    };
  } catch (error) {
    if (error instanceof NavConnectionError) throw error;
    throw new NavConnectionError("NAV_CREDENTIAL_ENVELOPE_INVALID");
  } finally {
    key.fill(0);
  }
}

export function decryptNavCredentials(
  envelope: NavCredentialEnvelope,
  revision: number,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  if (
    envelope.encryptedCredentials.length === 0 ||
    envelope.encryptionIv.length !== IV_BYTES ||
    envelope.authenticationTag.length !== TAG_BYTES
  )
    throw new NavConnectionError("NAV_CREDENTIAL_ENVELOPE_INVALID");
  const key = masterKey(envelope.keyVersion, environment);
  try {
    const decipher = createDecipheriv(ALGORITHM, key, envelope.encryptionIv, {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(aad(envelope.keyVersion, revision));
    decipher.setAuthTag(envelope.authenticationTag);
    return Buffer.concat([
      decipher.update(envelope.encryptedCredentials),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new NavConnectionError("NAV_CREDENTIAL_DECRYPT_FAILED");
  } finally {
    key.fill(0);
  }
}

@Injectable()
export class NavCredentialCryptoService {
  validateActiveKey(): void {
    const version = activeVersion(process.env);
    const key = masterKey(version, process.env);
    key.fill(0);
  }

  encrypt(plaintext: string, revision: number): NavCredentialEnvelope {
    return encryptNavCredentials(plaintext, revision);
  }

  decrypt(envelope: NavCredentialEnvelope, revision: number): string {
    return decryptNavCredentials(envelope, revision);
  }
}
