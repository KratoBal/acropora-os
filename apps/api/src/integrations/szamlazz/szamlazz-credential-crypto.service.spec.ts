import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  decryptSzamlazzCredential,
  encryptSzamlazzCredential,
  validateActiveSzamlazzMasterKey,
  validateSzamlazzCredentialEnvelope,
} from "./szamlazz-credential-crypto.service.js";

const key = Buffer.alloc(32, 7).toString("base64");
const environment = {
  SZAMLAZZ_CREDENTIAL_ACTIVE_KEY_VERSION: "1",
  SZAMLAZZ_CREDENTIAL_MASTER_KEY_V1: key,
};

describe("Számlázz.hu credential AES-256-GCM", () => {
  it("round-trips with a fresh 12 byte IV and versioned AAD", () => {
    let counter = 0;
    const random = (size: number) => Buffer.alloc(size, ++counter);
    const first = encryptSzamlazzCredential(
      "candidate-agent-key",
      3,
      environment,
      random,
    );
    const second = encryptSzamlazzCredential(
      "candidate-agent-key",
      3,
      environment,
      random,
    );

    assert.equal(first.encryptionIv.length, 12);
    assert.equal(first.authenticationTag.length, 16);
    assert.notDeepEqual(first.encryptionIv, second.encryptionIv);
    assert.equal(
      decryptSzamlazzCredential(first, 3, environment),
      "candidate-agent-key",
    );
    assert.doesNotThrow(() =>
      validateSzamlazzCredentialEnvelope(first, 3, environment),
    );
  });

  it("fails closed for tampered ciphertext, tag, AAD revision and wrong key", () => {
    const envelope = encryptSzamlazzCredential(
      "candidate-agent-key",
      4,
      environment,
      (size) => Buffer.alloc(size, 9),
    );
    const tamperedCiphertext = {
      ...envelope,
      encryptedAgentKey: Buffer.from(envelope.encryptedAgentKey),
    };
    tamperedCiphertext.encryptedAgentKey[0]! ^= 1;
    assert.throws(
      () => decryptSzamlazzCredential(tamperedCiphertext, 4, environment),
      /SZAMLAZZ_CREDENTIAL_DECRYPT_FAILED/,
    );
    assert.throws(
      () => decryptSzamlazzCredential(envelope, 5, environment),
      /SZAMLAZZ_CREDENTIAL_DECRYPT_FAILED/,
    );
    assert.throws(
      () =>
        decryptSzamlazzCredential(envelope, 4, {
          ...environment,
          SZAMLAZZ_CREDENTIAL_MASTER_KEY_V1: Buffer.alloc(32, 8).toString(
            "base64",
          ),
        }),
      /SZAMLAZZ_CREDENTIAL_DECRYPT_FAILED/,
    );
  });

  it("rejects missing, malformed and unknown-version master keys", () => {
    assert.throws(
      () => encryptSzamlazzCredential("secret", 1, {}),
      /SZAMLAZZ_CREDENTIAL_MASTER_KEY_NOT_CONFIGURED/,
    );
    assert.throws(
      () =>
        encryptSzamlazzCredential("secret", 1, {
          SZAMLAZZ_CREDENTIAL_ACTIVE_KEY_VERSION: "1",
          SZAMLAZZ_CREDENTIAL_MASTER_KEY_V1: "not-base64",
        }),
      /SZAMLAZZ_CREDENTIAL_MASTER_KEY_INVALID/,
    );
    const envelope = encryptSzamlazzCredential("secret", 1, environment);
    assert.throws(
      () => decryptSzamlazzCredential(envelope, 1, {}),
      /SZAMLAZZ_CREDENTIAL_MASTER_KEY_NOT_CONFIGURED/,
    );
  });

  it("validates the active production write key without retaining it", () => {
    assert.doesNotThrow(() => validateActiveSzamlazzMasterKey(environment));
    assert.throws(
      () => validateActiveSzamlazzMasterKey({}),
      /SZAMLAZZ_CREDENTIAL_MASTER_KEY_NOT_CONFIGURED/,
    );
  });
});
