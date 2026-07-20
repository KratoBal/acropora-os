import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  decryptUnasCredential,
  encryptUnasCredential,
  validateActiveUnasMasterKey,
  validateUnasCredentialEnvelope,
} from "./unas-credential-crypto.service.js";

const key = Buffer.alloc(32, 7).toString("base64");
const environment = {
  UNAS_CREDENTIAL_ACTIVE_KEY_VERSION: "1",
  UNAS_CREDENTIAL_MASTER_KEY_V1: key,
};

describe("UNAS credential AES-256-GCM", () => {
  it("round-trips with a fresh 12 byte IV and versioned AAD", () => {
    let counter = 0;
    const random = (size: number) => Buffer.alloc(size, ++counter);
    const first = encryptUnasCredential(
      "candidate-secret",
      3,
      environment,
      random,
    );
    const second = encryptUnasCredential(
      "candidate-secret",
      3,
      environment,
      random,
    );

    assert.equal(first.encryptionIv.length, 12);
    assert.equal(first.authenticationTag.length, 16);
    assert.notDeepEqual(first.encryptionIv, second.encryptionIv);
    assert.equal(
      decryptUnasCredential(first, 3, environment),
      "candidate-secret",
    );
    assert.doesNotThrow(() =>
      validateUnasCredentialEnvelope(first, 3, environment),
    );
  });

  it("fails closed for tampered ciphertext, tag, AAD revision and wrong key", () => {
    const envelope = encryptUnasCredential(
      "candidate-secret",
      4,
      environment,
      (size) => Buffer.alloc(size, 9),
    );
    const tamperedCiphertext = {
      ...envelope,
      encryptedApiKey: Buffer.from(envelope.encryptedApiKey),
    };
    tamperedCiphertext.encryptedApiKey[0]! ^= 1;
    assert.throws(
      () => decryptUnasCredential(tamperedCiphertext, 4, environment),
      /UNAS_CREDENTIAL_DECRYPT_FAILED/,
    );
    assert.throws(
      () => decryptUnasCredential(envelope, 5, environment),
      /UNAS_CREDENTIAL_DECRYPT_FAILED/,
    );
    assert.throws(
      () =>
        decryptUnasCredential(envelope, 4, {
          ...environment,
          UNAS_CREDENTIAL_MASTER_KEY_V1: Buffer.alloc(32, 8).toString("base64"),
        }),
      /UNAS_CREDENTIAL_DECRYPT_FAILED/,
    );
  });

  it("rejects missing, malformed and unknown-version master keys", () => {
    assert.throws(
      () => encryptUnasCredential("secret", 1, {}),
      /UNAS_CREDENTIAL_MASTER_KEY_NOT_CONFIGURED/,
    );
    assert.throws(
      () =>
        encryptUnasCredential("secret", 1, {
          UNAS_CREDENTIAL_ACTIVE_KEY_VERSION: "1",
          UNAS_CREDENTIAL_MASTER_KEY_V1: "not-base64",
        }),
      /UNAS_CREDENTIAL_MASTER_KEY_INVALID/,
    );
    const envelope = encryptUnasCredential("secret", 1, environment);
    assert.throws(
      () => decryptUnasCredential(envelope, 1, {}),
      /UNAS_CREDENTIAL_MASTER_KEY_NOT_CONFIGURED/,
    );
  });

  it("validates the active production write key without retaining it", () => {
    assert.doesNotThrow(() => validateActiveUnasMasterKey(environment));
    assert.throws(
      () => validateActiveUnasMasterKey({}),
      /UNAS_CREDENTIAL_MASTER_KEY_NOT_CONFIGURED/,
    );
  });
});
