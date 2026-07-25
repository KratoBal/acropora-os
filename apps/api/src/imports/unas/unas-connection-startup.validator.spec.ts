import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";

import { Logger } from "@nestjs/common";

import type { UnasConnectionRepository } from "./unas-connection.repository.js";
import { UnasConnectionStartupValidator } from "./unas-connection-startup.validator.js";
import {
  UnasConnectionError,
  type UnasConnectionSettingRecord,
} from "./unas-connection.types.js";
import type { UnasCredentialCryptoService } from "./unas-credential-crypto.service.js";
import type { UnasCredentialProvider } from "./unas-credential.provider.js";

const originalNodeEnv = process.env.NODE_ENV;
afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
});

const setting = (
  credentialMode: UnasConnectionSettingRecord["credentialMode"],
): UnasConnectionSettingRecord => ({
  id: "unas",
  credentialMode,
  encryptedApiKey:
    credentialMode === "DATABASE" ? Buffer.from("ciphertext") : null,
  encryptionIv: credentialMode === "DATABASE" ? Buffer.alloc(12) : null,
  authenticationTag: credentialMode === "DATABASE" ? Buffer.alloc(16) : null,
  keyVersion: credentialMode === "DATABASE" ? "1" : null,
  credentialRevision: 1,
  credentialUpdatedAt: null,
  verificationStatus: "NEVER",
  lastVerifiedAt: null,
  lastVerificationCode: null,
});

function validator(
  record: UnasConnectionSettingRecord | null,
  options: { activeKeyError?: Error; validationError?: Error } = {},
) {
  const calls = { activeKey: 0, validate: 0 };
  const instance = new UnasConnectionStartupValidator(
    { getSetting: async () => record } as UnasConnectionRepository,
    {
      validateActiveKey: () => {
        calls.activeKey += 1;
        if (options.activeKeyError) throw options.activeKeyError;
      },
    } as unknown as UnasCredentialCryptoService,
    {
      validateRecord: () => {
        calls.validate += 1;
        if (options.validationError) throw options.validationError;
      },
    } as unknown as UnasCredentialProvider,
  );
  return { instance, calls };
}

describe("UnasConnectionStartupValidator", () => {
  it("does not impose production secret requirements in development", async () => {
    process.env.NODE_ENV = "development";
    const { instance, calls } = validator(null);
    await instance.onModuleInit();
    assert.deepEqual(calls, { activeKey: 0, validate: 0 });
  });

  it("fails production startup when the singleton is missing", async () => {
    process.env.NODE_ENV = "production";
    const { instance } = validator(null);
    await assert.rejects(
      instance.onModuleInit(),
      /UNAS_CONNECTION_CONFIGURATION_MISSING/,
    );
  });

  it("requires an active write key in every production mode", async () => {
    process.env.NODE_ENV = "production";
    for (const mode of ["ENV_FALLBACK", "DISABLED", "DATABASE"] as const) {
      const { instance } = validator(setting(mode), {
        activeKeyError: new UnasConnectionError(
          "UNAS_CREDENTIAL_MASTER_KEY_INVALID",
        ),
      });
      await assert.rejects(
        instance.onModuleInit(),
        /UNAS_CREDENTIAL_MASTER_KEY_INVALID/,
      );
    }
  });

  it("validates ENV_FALLBACK and accepts DISABLED without a credential", async () => {
    process.env.NODE_ENV = "production";
    for (const mode of ["ENV_FALLBACK", "DISABLED"] as const) {
      const { instance, calls } = validator(setting(mode));
      await instance.onModuleInit();
      assert.deepEqual(calls, { activeKey: 1, validate: 1 });
    }
  });

  it("allows production ENV_FALLBACK startup to continue, with a warning, when no credential is set yet", async () => {
    process.env.NODE_ENV = "production";
    const warnSpy = mock.method(Logger.prototype, "warn");
    try {
      const { instance, calls } = validator(setting("ENV_FALLBACK"), {
        validationError: new UnasConnectionError(
          "UNAS_CONNECTION_NOT_CONFIGURED",
        ),
      });
      await instance.onModuleInit();
      assert.deepEqual(calls, { activeKey: 1, validate: 1 });
      assert.equal(warnSpy.mock.calls.length, 1);
      assert.match(
        String(warnSpy.mock.calls[0]?.arguments[0]),
        /UNAS_CONNECTION_NOT_CONFIGURED/,
      );
    } finally {
      warnSpy.mock.restore();
    }
  });

  it("requires a decryptable DATABASE envelope", async () => {
    process.env.NODE_ENV = "production";
    const calls = { activeKey: 0 };
    const instance = new UnasConnectionStartupValidator(
      {
        getSetting: async () => setting("DATABASE"),
      } as UnasConnectionRepository,
      {
        validateActiveKey: () => {
          calls.activeKey += 1;
        },
      } as unknown as UnasCredentialCryptoService,
      {
        validateRecord: () => {
          throw new UnasConnectionError("UNAS_CREDENTIAL_DECRYPT_FAILED");
        },
      } as unknown as UnasCredentialProvider,
    );
    await assert.rejects(
      instance.onModuleInit(),
      /UNAS_CREDENTIAL_DECRYPT_FAILED/,
    );
    assert.equal(calls.activeKey, 1);
  });

  it("normalizes unknown startup failures without exposing their content", async () => {
    process.env.NODE_ENV = "production";
    const { instance } = validator(setting("DATABASE"), {
      validationError: new Error(
        "candidate-secret session-token <Error>private XML</Error>",
      ),
    });
    await assert.rejects(
      instance.onModuleInit(),
      (error: unknown) =>
        error instanceof Error && error.message === "UNAS_CONNECTION_FAILED",
    );
  });
});
