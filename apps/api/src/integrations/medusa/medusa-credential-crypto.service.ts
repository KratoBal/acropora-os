import { Injectable } from "@nestjs/common";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import {
  MedusaConnectionError,
  type MedusaCredentialEnvelope,
} from "./medusa-connection.types.js";

/**
 * A Medusa admin kulcs titkosítása, az UNAS és a NAV mintájának MÁSOLATA.
 *
 * Miért másolat és nem közös szolgáltatás: a kiemelés két, élesben futó
 * integrációt írna át, és ennek a körnek nem ez a tétje. Ha lesz negyedik
 * integráció, akkor már a kiemelés az olcsóbb.
 *
 * Amiben ez a másolat KÜLÖNBÖZIK a mintától, és szándékosan: saját környezeti
 * változók (`MEDUSA_CREDENTIAL_MASTER_KEY_V<n>`), és a hitelesített kiegészítő
 * adat a MEDUSA integrációt nevezi meg. Így egy UNAS-boríték nem fejthető
 * vissza Medusa-mesterkulccsal, még ha valaki a sorokat összekeverné is.
 */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const VERSION_PATTERN = /^[1-9]\d{0,5}$/;

/**
 * A boríték a SAJÁT helyéhez van kötve: az integráció neve, a séma verziója, a
 * kulcsverzió és a rekord revíziója mind a hitelesített kiegészítő adat része.
 * Egy másik rekord vagy egy másik revízió borítékja ezért nem cserélhető át.
 */
function aad(version: string, revision: number): Buffer {
  return Buffer.from(
    `acropora-os|integration:medusa|secret:admin-api-key|schema:1|key:${version}|revision:${revision}`,
    "utf8",
  );
}

function masterKey(version: string, environment: NodeJS.ProcessEnv): Buffer {
  if (!VERSION_PATTERN.test(version))
    throw new MedusaConnectionError("MEDUSA_CREDENTIAL_KEY_VERSION_UNKNOWN");
  const encoded = environment[`MEDUSA_CREDENTIAL_MASTER_KEY_V${version}`];
  if (!encoded)
    throw new MedusaConnectionError(
      "MEDUSA_CREDENTIAL_MASTER_KEY_NOT_CONFIGURED",
    );
  if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
    throw new MedusaConnectionError("MEDUSA_CREDENTIAL_MASTER_KEY_INVALID");
  const decoded = Buffer.from(encoded, "base64");
  if (decoded.length !== KEY_BYTES || decoded.toString("base64") !== encoded) {
    decoded.fill(0);
    throw new MedusaConnectionError("MEDUSA_CREDENTIAL_MASTER_KEY_INVALID");
  }
  return decoded;
}

export function validateActiveMedusaMasterKey(
  environment: NodeJS.ProcessEnv = process.env,
): void {
  const version = environment.MEDUSA_CREDENTIAL_ACTIVE_KEY_VERSION;
  if (!version || !VERSION_PATTERN.test(version))
    throw new MedusaConnectionError(
      "MEDUSA_CREDENTIAL_MASTER_KEY_NOT_CONFIGURED",
    );
  const key = masterKey(version, environment);
  key.fill(0);
}

export function encryptMedusaCredential(
  plaintext: string,
  revision: number,
  environment: NodeJS.ProcessEnv = process.env,
  random: (size: number) => Buffer = randomBytes,
): MedusaCredentialEnvelope {
  const version = environment.MEDUSA_CREDENTIAL_ACTIVE_KEY_VERSION;
  if (!version || !VERSION_PATTERN.test(version))
    throw new MedusaConnectionError(
      "MEDUSA_CREDENTIAL_MASTER_KEY_NOT_CONFIGURED",
    );
  const key = masterKey(version, environment);
  try {
    const iv = random(IV_BYTES);
    if (iv.length !== IV_BYTES)
      throw new MedusaConnectionError("MEDUSA_CREDENTIAL_ENVELOPE_INVALID");
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
    if (error instanceof MedusaConnectionError) throw error;
    throw new MedusaConnectionError("MEDUSA_CREDENTIAL_ENVELOPE_INVALID");
  } finally {
    key.fill(0);
  }
}

export function decryptMedusaCredential(
  envelope: MedusaCredentialEnvelope,
  revision: number,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const plaintext = decryptMedusaCredentialBuffer(
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

function decryptMedusaCredentialBuffer(
  envelope: MedusaCredentialEnvelope,
  revision: number,
  environment: NodeJS.ProcessEnv = process.env,
): Buffer {
  if (
    envelope.encryptedApiKey.length === 0 ||
    envelope.encryptionIv.length !== IV_BYTES ||
    envelope.authenticationTag.length !== TAG_BYTES
  )
    throw new MedusaConnectionError("MEDUSA_CREDENTIAL_ENVELOPE_INVALID");
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
    throw new MedusaConnectionError("MEDUSA_CREDENTIAL_DECRYPT_FAILED");
  } finally {
    key.fill(0);
  }
}

export function validateMedusaCredentialEnvelope(
  envelope: MedusaCredentialEnvelope,
  revision: number,
  environment: NodeJS.ProcessEnv = process.env,
): void {
  const plaintext = decryptMedusaCredentialBuffer(
    envelope,
    revision,
    environment,
  );
  plaintext.fill(0);
}

@Injectable()
export class MedusaCredentialCryptoService {
  validateActiveKey(): void {
    validateActiveMedusaMasterKey();
  }

  encrypt(plaintext: string, revision: number): MedusaCredentialEnvelope {
    return encryptMedusaCredential(plaintext, revision);
  }

  decrypt(envelope: MedusaCredentialEnvelope, revision: number): string {
    return decryptMedusaCredential(envelope, revision);
  }

  validateEnvelope(envelope: MedusaCredentialEnvelope, revision: number): void {
    validateMedusaCredentialEnvelope(envelope, revision);
  }
}
