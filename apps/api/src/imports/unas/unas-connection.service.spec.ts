import assert from "node:assert/strict";
import { HttpException } from "@nestjs/common";
import { describe, it } from "node:test";

import {
  UnasApiError,
  type UnasApiClient,
  type UnasLoginResult,
} from "./unas-api.client.js";
import type { UnasConnectionRepository } from "./unas-connection.repository.js";
import { UnasConnectionService } from "./unas-connection.service.js";
import type {
  StoredUnasVerificationStatus,
  UnasConnectionErrorCode,
  UnasConnectionSettingRecord,
} from "./unas-connection.types.js";
import { UnasConnectionError } from "./unas-connection.types.js";
import type { UnasCredentialCryptoService } from "./unas-credential-crypto.service.js";
import type { UnasCredentialProvider } from "./unas-credential.provider.js";
import type { UnasClock } from "./unas-login-expiry.js";

const LOGIN_NOW_MS = 1_999_996_400_000;

const baseSetting = (
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

class FakeRepository {
  setting = baseSetting();
  allowCooldown = true;
  cooldownError: Error | undefined;
  replacements = 0;
  manualAudits: Array<{
    status?: StoredUnasVerificationStatus;
    code: UnasConnectionErrorCode | null;
    result?: "STALE_TEST_RESULT";
  }> = [];
  validationFailures: UnasConnectionErrorCode[] = [];
  beforeRecordManualTest?: () => void;

  async getSetting(): Promise<UnasConnectionSettingRecord | null> {
    return this.setting;
  }

  async claimCooldown() {
    if (this.cooldownError) throw this.cooldownError;
    return this.allowCooldown ? this.setting : null;
  }

  async replaceCredential(input: {
    revision: number;
    verifiedAt: Date;
    verificationStatus: "SUCCESS" | "INDETERMINATE";
    verificationCode: UnasConnectionErrorCode | null;
  }) {
    this.replacements += 1;
    this.setting = baseSetting({
      credentialMode: "DATABASE",
      encryptedApiKey: Buffer.from("encrypted"),
      encryptionIv: Buffer.alloc(12),
      authenticationTag: Buffer.alloc(16),
      keyVersion: "1",
      credentialRevision: input.revision,
      credentialUpdatedAt: input.verifiedAt,
      verificationStatus: input.verificationStatus,
      lastVerifiedAt: input.verifiedAt,
      lastVerificationCode: input.verificationCode,
    });
    return this.setting;
  }

  async disable(_actor: string, now: Date) {
    this.setting = baseSetting({
      credentialMode: "DISABLED",
      credentialRevision: this.setting.credentialRevision + 1,
      credentialUpdatedAt: now,
    });
    return this.setting;
  }

  async recordManualTest(input: {
    status: Exclude<StoredUnasVerificationStatus, "NEVER">;
    code: UnasConnectionErrorCode | null;
    checkedAt: Date;
    expectedCredentialMode: UnasConnectionSettingRecord["credentialMode"];
    expectedCredentialRevision: number;
  }) {
    this.beforeRecordManualTest?.();
    const stale =
      this.setting.credentialMode !== input.expectedCredentialMode ||
      this.setting.credentialRevision !== input.expectedCredentialRevision;
    this.manualAudits.push(
      stale
        ? { result: "STALE_TEST_RESULT", code: null }
        : { status: input.status, code: input.code },
    );
    if (!stale)
      this.setting = {
        ...this.setting,
        verificationStatus: input.status,
        lastVerificationCode: input.code,
        lastVerifiedAt: input.checkedAt,
      };
    return { setting: this.setting, stale };
  }

  async auditCredentialValidationFailure(
    _actor: string,
    code: UnasConnectionErrorCode,
  ) {
    this.validationFailures.push(code);
  }
}

const service = (
  repository: FakeRepository,
  login: (apiKey: string) => Promise<UnasLoginResult>,
) =>
  new UnasConnectionService(
    repository as unknown as UnasConnectionRepository,
    {
      encrypt: () => ({
        encryptedApiKey: Buffer.from("encrypted"),
        encryptionIv: Buffer.alloc(12),
        authenticationTag: Buffer.alloc(16),
        keyVersion: "1",
      }),
    } as unknown as UnasCredentialCryptoService,
    {
      resolve: async () => ({
        apiKey: "stored-secret",
        revision: "database:1",
      }),
      resolveRecord: () => ({
        apiKey: "stored-secret",
        revision: "database:1",
      }),
    } as unknown as UnasCredentialProvider,
    { login } as unknown as UnasApiClient,
    { nowMs: () => LOGIN_NOW_MS } as UnasClock,
  );

const login = (permissions: readonly string[] | null) => async () => ({
  token: "session-token-must-not-leak",
  expireTime: 2_000_000_000,
  permissions,
});

async function exceptionCode(action: () => Promise<unknown>) {
  try {
    await action();
    assert.fail("Expected HttpException");
  } catch (error) {
    assert.ok(error instanceof HttpException);
    return String(error.getResponse());
  }
}

describe("UnasConnectionService", () => {
  it("validates a candidate with read-only login before storing it", async () => {
    const repository = new FakeRepository();
    let received = "";
    const result = await service(repository, async (apiKey) => {
      received = apiKey;
      return (await login(["getProduct", "getCategory"])()) as UnasLoginResult;
    }).replaceCredential(" candidate-secret ", "admin-1", new Date(0));

    assert.equal(received, "candidate-secret");
    assert.equal(repository.replacements, 1);
    assert.equal(result.verification.status, "SUCCESS");
    assert.equal(JSON.stringify(result).includes("candidate-secret"), false);
    assert.equal(JSON.stringify(result).includes("session-token"), false);
  });

  it("fails closed when the singleton is missing in the GET projection", async () => {
    const repository = new FakeRepository();
    repository.getSetting = async () => null;
    const code = await exceptionCode(() =>
      service(repository, login([]).bind(null)).get(),
    );
    assert.equal(code, "UNAS_CONNECTION_CONFIGURATION_MISSING");
  });

  it("fails closed on every mutation path when the singleton is missing", async () => {
    for (const action of [
      (candidate: UnasConnectionService) =>
        candidate.replaceCredential("candidate-secret", "admin-1"),
      (candidate: UnasConnectionService) =>
        candidate.testStoredCredential("admin-1"),
      (candidate: UnasConnectionService) => candidate.disable("admin-1"),
    ]) {
      const repository = new FakeRepository();
      repository.cooldownError = new UnasConnectionError(
        "UNAS_CONNECTION_CONFIGURATION_MISSING",
      );
      const code = await exceptionCode(() =>
        action(service(repository, login([]).bind(null))),
      );
      assert.equal(code, "UNAS_CONNECTION_CONFIGURATION_MISSING");
    }
  });

  it("rejects known missing permissions without activating the candidate", async () => {
    const repository = new FakeRepository();
    const code = await exceptionCode(() =>
      service(repository, login(["getProduct"]).bind(null)).replaceCredential(
        "candidate-secret",
        "admin-1",
      ),
    );
    assert.equal(code, "UNAS_CONNECTION_PERMISSION_MISSING");
    assert.equal(repository.replacements, 0);
    assert.deepEqual(repository.validationFailures, [
      "UNAS_CONNECTION_PERMISSION_MISSING",
    ]);
  });

  it("stores unknown permission shapes as INDETERMINATE with a safe warning", async () => {
    const repository = new FakeRepository();
    const result = await service(
      repository,
      login(null).bind(null),
    ).replaceCredential("candidate-secret", "admin-1");
    assert.equal(repository.replacements, 1);
    assert.equal(result.verification.status, "INDETERMINATE");
    assert.equal(
      result.verification.code,
      "UNAS_CONNECTION_PERMISSION_UNKNOWN",
    );
  });

  it("rejects expired login before storing the candidate", async () => {
    const repository = new FakeRepository();
    const code = await exceptionCode(() =>
      service(repository, async () => ({
        token: "expired-token",
        expireTime: LOGIN_NOW_MS / 1000,
        permissions: ["getProduct", "getCategory"],
      })).replaceCredential("candidate-secret", "admin-1"),
    );
    assert.equal(code, "UNAS_CONNECTION_RESPONSE_INVALID");
    assert.equal(repository.replacements, 0);
  });

  it("audits an executed stored test but does not amplify cooldown rejections", async () => {
    const repository = new FakeRepository();
    await service(
      repository,
      login(["getProduct", "getCategory"]).bind(null),
    ).testStoredCredential("admin-1", new Date(0));
    assert.deepEqual(repository.manualAudits, [
      { status: "SUCCESS", code: null },
    ]);

    repository.allowCooldown = false;
    const code = await exceptionCode(() =>
      service(repository, login([]).bind(null)).testStoredCredential("admin-1"),
    );
    assert.equal(code, "UNAS_CONNECTION_RATE_LIMITED");
    assert.equal(repository.manualAudits.length, 1);
  });

  it("does not let an old test overwrite a concurrently replaced credential", async () => {
    const repository = new FakeRepository();
    repository.setting = baseSetting({
      credentialMode: "DATABASE",
      encryptedApiKey: Buffer.from("old-encrypted"),
      encryptionIv: Buffer.alloc(12),
      authenticationTag: Buffer.alloc(16),
      keyVersion: "1",
      credentialRevision: 5,
      verificationStatus: "SUCCESS",
    });
    repository.beforeRecordManualTest = () => {
      repository.setting = baseSetting({
        credentialMode: "DATABASE",
        encryptedApiKey: Buffer.from("new-encrypted"),
        encryptionIv: Buffer.alloc(12),
        authenticationTag: Buffer.alloc(16),
        keyVersion: "1",
        credentialRevision: 6,
        verificationStatus: "INDETERMINATE",
        lastVerificationCode: "UNAS_CONNECTION_PERMISSION_UNKNOWN",
      });
    };
    const result = await service(
      repository,
      login(["getProduct", "getCategory"]).bind(null),
    ).testStoredCredential("admin-1");
    assert.equal(result.verification.status, "INDETERMINATE");
    assert.equal(
      result.verification.code,
      "UNAS_CONNECTION_PERMISSION_UNKNOWN",
    );
    assert.deepEqual(repository.manualAudits, [
      { result: "STALE_TEST_RESULT", code: null },
    ]);
  });

  it("does not let an old test overwrite a concurrent disable", async () => {
    const repository = new FakeRepository();
    repository.setting = baseSetting({
      credentialMode: "DATABASE",
      encryptedApiKey: Buffer.from("old-encrypted"),
      encryptionIv: Buffer.alloc(12),
      authenticationTag: Buffer.alloc(16),
      keyVersion: "1",
      credentialRevision: 8,
    });
    repository.beforeRecordManualTest = () => {
      repository.setting = baseSetting({
        credentialMode: "DISABLED",
        credentialRevision: 9,
        verificationStatus: "NEVER",
      });
    };
    const result = await service(
      repository,
      login(["getProduct", "getCategory"]).bind(null),
    ).testStoredCredential("admin-1");
    assert.equal(result.configured, false);
    assert.equal(result.verification.status, "NEVER");
    assert.deepEqual(repository.manualAudits, [
      { result: "STALE_TEST_RESULT", code: null },
    ]);
  });

  it("applies the credential-change cooldown before login or disable", async () => {
    const repository = new FakeRepository();
    repository.allowCooldown = false;
    let loginCalls = 0;
    const connection = service(repository, async () => {
      loginCalls += 1;
      return (await login([])()) as UnasLoginResult;
    });
    assert.equal(
      await exceptionCode(() =>
        connection.replaceCredential("candidate-secret", "admin-1"),
      ),
      "UNAS_CONNECTION_RATE_LIMITED",
    );
    assert.equal(
      await exceptionCode(() => connection.disable("admin-1")),
      "UNAS_CONNECTION_RATE_LIMITED",
    );
    assert.equal(loginCalls, 0);
  });

  it("maps upstream failures to an allowlisted connection-test result", async () => {
    const cases = [
      ["AUTH_REJECTED", "UNAS_CONNECTION_AUTH_REJECTED"],
      ["RATE_LIMITED", "UNAS_CONNECTION_RATE_LIMITED_UPSTREAM"],
      ["HTTP_4XX", "UNAS_CONNECTION_HTTP_4XX"],
      ["HTTP_5XX", "UNAS_CONNECTION_HTTP_5XX"],
      ["TIMEOUT", "UNAS_CONNECTION_TIMEOUT"],
      ["NETWORK_FAILED", "UNAS_CONNECTION_NETWORK_FAILED"],
      ["API_REJECTED", "UNAS_CONNECTION_API_REJECTED"],
      ["XML_INVALID", "UNAS_CONNECTION_RESPONSE_INVALID"],
      ["XML_TOO_LARGE", "UNAS_CONNECTION_RESPONSE_INVALID"],
      ["FIELD_FORMAT_INVALID", "UNAS_CONNECTION_RESPONSE_INVALID"],
    ] as const;
    for (const [upstream, expected] of cases) {
      const repository = new FakeRepository();
      const result = await service(repository, async () => {
        throw new UnasApiError(upstream);
      }).testStoredCredential("admin-1", new Date(0));
      assert.equal(result.verification.status, "FAILED");
      assert.equal(result.verification.code, expected);
      assert.deepEqual(repository.manualAudits, [
        { status: "FAILED", code: expected },
      ]);
    }
  });

  it("normalizes raw failures without credential, token, product or payload leakage", async () => {
    const repository = new FakeRepository();
    const sensitive = [
      "candidate-secret",
      "session-token",
      "SKU-PRIVATE",
      "Product Private Name",
      "<Error>private body</Error>",
    ];
    const output: unknown[][] = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (...args: unknown[]) => output.push(args);
    console.error = (...args: unknown[]) => output.push(args);
    let code: string;
    try {
      code = await exceptionCode(() =>
        service(repository, async () => {
          throw new Error(sensitive.join(" | "));
        }).replaceCredential("candidate-secret", "admin-1"),
      );
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }
    assert.equal(code, "UNAS_CONNECTION_FAILED");
    assert.deepEqual(output, []);
    for (const secret of sensitive) assert.equal(code.includes(secret), false);
    assert.deepEqual(repository.validationFailures, ["UNAS_CONNECTION_FAILED"]);
  });

  it("derives STALE after 24 hours without disabling the configured state", async () => {
    const repository = new FakeRepository();
    repository.setting = baseSetting({
      credentialMode: "DATABASE",
      encryptedApiKey: Buffer.from("encrypted"),
      encryptionIv: Buffer.alloc(12),
      authenticationTag: Buffer.alloc(16),
      keyVersion: "1",
      verificationStatus: "SUCCESS",
      lastVerifiedAt: new Date(0),
    });
    const result = await service(repository, login([]).bind(null)).get(
      new Date(24 * 60 * 60 * 1000 + 1),
    );
    assert.equal(result.configured, true);
    assert.equal(result.verification.status, "STALE");
    assert.equal(
      result.verification.code,
      "UNAS_CONNECTION_VERIFICATION_STALE",
    );
  });

  it("maps an unknown persisted error string to the generic allowlisted code", async () => {
    const repository = new FakeRepository();
    repository.setting = baseSetting({
      verificationStatus: "FAILED",
      lastVerificationCode:
        "candidate-secret session-token <Error>raw payload</Error>",
    });
    const result = await service(repository, login([]).bind(null)).get();
    assert.equal(result.verification.code, "UNAS_CONNECTION_FAILED");
    assert.equal(JSON.stringify(result).includes("candidate-secret"), false);
  });

  it("disables the credential without exposing or retaining an API projection", async () => {
    const repository = new FakeRepository();
    repository.setting = baseSetting({
      credentialMode: "DATABASE",
      encryptedApiKey: Buffer.from("encrypted"),
      encryptionIv: Buffer.alloc(12),
      authenticationTag: Buffer.alloc(16),
      keyVersion: "1",
    });
    const result = await service(repository, login([]).bind(null)).disable(
      "admin-1",
      new Date(0),
    );
    assert.equal(result.configured, false);
    assert.equal(result.masked, null);
    assert.equal(repository.setting.encryptedApiKey, null);
  });
});
