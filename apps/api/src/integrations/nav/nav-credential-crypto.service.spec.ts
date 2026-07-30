import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  decryptNavCredentials,
  encryptNavCredentials,
} from "./nav-credential-crypto.service.js";

const environment = {
  NAV_CREDENTIAL_ACTIVE_KEY_VERSION: "1",
  NAV_CREDENTIAL_MASTER_KEY_V1: Buffer.alloc(32, 7).toString("base64"),
};

describe("NAV credential encryption", () => {
  it("round-trips the credential payload without exposing plaintext", () => {
    const plaintext =
      '{"technicalUserLogin":"candidate-secret","technicalUserPassword":"password"}';
    const envelope = encryptNavCredentials(plaintext, 3, environment, () =>
      Buffer.alloc(12, 9),
    );

    assert.notEqual(envelope.encryptedCredentials.toString("utf8"), plaintext);
    assert.equal(decryptNavCredentials(envelope, 3, environment), plaintext);
  });

  it("binds ciphertext to the credential revision", () => {
    const envelope = encryptNavCredentials("secret", 3, environment, () =>
      Buffer.alloc(12, 5),
    );

    assert.throws(
      () => decryptNavCredentials(envelope, 4, environment),
      /NAV_CREDENTIAL_DECRYPT_FAILED/,
    );
  });

  it("rejects missing and malformed master keys", () => {
    assert.throws(
      () =>
        encryptNavCredentials("secret", 1, {
          NAV_CREDENTIAL_ACTIVE_KEY_VERSION: "1",
        }),
      /NAV_CREDENTIAL_MASTER_KEY_NOT_CONFIGURED/,
    );
    assert.throws(
      () =>
        encryptNavCredentials("secret", 1, {
          NAV_CREDENTIAL_ACTIVE_KEY_VERSION: "1",
          NAV_CREDENTIAL_MASTER_KEY_V1: "not-base64",
        }),
      /NAV_CREDENTIAL_MASTER_KEY_INVALID/,
    );
  });
});
