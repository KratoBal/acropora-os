import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import type { UnasConnectionRepository } from "./unas-connection.repository.js";
import type { UnasConnectionSettingRecord } from "./unas-connection.types.js";
import type { UnasCredentialCryptoService } from "./unas-credential-crypto.service.js";
import { UnasCredentialProvider } from "./unas-credential.provider.js";

const originalApiKey = process.env.UNAS_API_KEY;
afterEach(() => {
  if (originalApiKey === undefined) delete process.env.UNAS_API_KEY;
  else process.env.UNAS_API_KEY = originalApiKey;
});

const setting = (
  overrides: Partial<UnasConnectionSettingRecord> = {},
): UnasConnectionSettingRecord => ({
  id: "unas",
  credentialMode: "ENV_FALLBACK",
  encryptedApiKey: null,
  encryptionIv: null,
  authenticationTag: null,
  keyVersion: null,
  credentialRevision: 0,
  credentialUpdatedAt: null,
  verificationStatus: "NEVER",
  lastVerifiedAt: null,
  lastVerificationCode: null,
  ...overrides,
});

const provider = (
  record: UnasConnectionSettingRecord | null,
  decrypt = () => "database-secret",
) =>
  new UnasCredentialProvider(
    { getSetting: async () => record } as UnasConnectionRepository,
    { decrypt } as unknown as UnasCredentialCryptoService,
  );

describe("UnasCredentialProvider", () => {
  it("uses the environment only for explicit ENV_FALLBACK settings", async () => {
    process.env.UNAS_API_KEY = " env-secret ";
    assert.equal((await provider(setting()).resolve()).apiKey, "env-secret");
  });

  it("fails closed when the singleton setting is missing", async () => {
    process.env.UNAS_API_KEY = "must-not-be-used";
    await assert.rejects(
      provider(null).resolve(),
      /UNAS_CONNECTION_CONFIGURATION_MISSING/,
    );
  });

  it("gives the database credential strict precedence", async () => {
    process.env.UNAS_API_KEY = "env-secret";
    const result = await provider(
      setting({
        credentialMode: "DATABASE",
        encryptedApiKey: Buffer.from("ciphertext"),
        encryptionIv: Buffer.alloc(12),
        authenticationTag: Buffer.alloc(16),
        keyVersion: "1",
        credentialRevision: 8,
      }),
    ).resolve();
    assert.equal(result.apiKey, "database-secret");
    assert.equal(result.revision, "database:8");
  });

  it("never falls back from DISABLED or a broken database envelope", async () => {
    process.env.UNAS_API_KEY = "must-not-be-used";
    await assert.rejects(
      provider(setting({ credentialMode: "DISABLED" })).resolve(),
      /UNAS_CONNECTION_DISABLED/,
    );
    await assert.rejects(
      provider(setting({ credentialMode: "DATABASE" })).resolve(),
      /UNAS_CREDENTIAL_ENVELOPE_INVALID/,
    );
    await assert.rejects(
      provider(
        setting({
          credentialMode: "DATABASE",
          encryptedApiKey: Buffer.from("ciphertext"),
          encryptionIv: Buffer.alloc(12),
          authenticationTag: Buffer.alloc(16),
          keyVersion: "1",
        }),
        () => {
          throw new Error("raw decrypt detail");
        },
      ).resolve(),
      /UNAS_CREDENTIAL_DECRYPT_FAILED/,
    );
  });

  it("fails safely when the fallback environment key is absent", async () => {
    delete process.env.UNAS_API_KEY;
    await assert.rejects(
      provider(setting()).resolve(),
      /UNAS_CONNECTION_NOT_CONFIGURED/,
    );
  });

  it("validates startup state without materializing ENV or DISABLED credentials", () => {
    delete process.env.UNAS_API_KEY;
    assert.throws(
      () => provider(setting()).validateRecord(setting()),
      /UNAS_CONNECTION_NOT_CONFIGURED/,
    );
    assert.doesNotThrow(() =>
      provider(setting({ credentialMode: "DISABLED" })).validateRecord(
        setting({ credentialMode: "DISABLED" }),
      ),
    );

    process.env.UNAS_API_KEY = "environment-secret";
    assert.doesNotThrow(() => provider(setting()).validateRecord(setting()));
  });

  it("validates a DATABASE envelope without returning its plaintext", () => {
    let validated = 0;
    const databaseSetting = setting({
      credentialMode: "DATABASE",
      encryptedApiKey: Buffer.from("ciphertext"),
      encryptionIv: Buffer.alloc(12),
      authenticationTag: Buffer.alloc(16),
      keyVersion: "1",
      credentialRevision: 7,
    });
    const candidate = new UnasCredentialProvider(
      { getSetting: async () => databaseSetting } as UnasConnectionRepository,
      {
        validateEnvelope: () => {
          validated += 1;
        },
      } as unknown as UnasCredentialCryptoService,
    );
    assert.equal(candidate.validateRecord(databaseSetting), undefined);
    assert.equal(validated, 1);
  });
});
