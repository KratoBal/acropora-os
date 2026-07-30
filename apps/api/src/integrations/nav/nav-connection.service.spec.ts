import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NavConnectionCredentialInput } from "@acropora/types";

import type { NavConnectionRepository } from "./nav-connection.repository.js";
import { NavConnectionService } from "./nav-connection.service.js";
import type {
  NavConnectionSettingRecord,
  NavCredentialEnvelope,
} from "./nav-connection.types.js";
import type { NavCredentialCryptoService } from "./nav-credential-crypto.service.js";
import {
  normalizeNavCredentialInput,
  type NavCredentialsService,
} from "./nav-credentials.service.js";
import { NavApiError } from "./nav-online-invoice.client.js";
import type { NavOnlineInvoiceClient } from "./nav-online-invoice.client.js";

const input: NavConnectionCredentialInput = {
  technicalUserLogin: "technical-user",
  technicalUserPassword: "password",
  technicalUserTaxNumber: "23916229",
  technicalUserSignKey: "sign-key",
  softwareId: "ACROPORAOS00000001",
  softwareDevName: "Acropora Kft.",
  softwareDevContact: "info@acropora.hu",
  softwareDevTaxNumber: "23916229",
};

function setting(
  overrides: Partial<NavConnectionSettingRecord> = {},
): NavConnectionSettingRecord {
  return {
    id: "nav",
    credentialMode: "ENV_FALLBACK",
    encryptedCredentials: null,
    encryptionIv: null,
    authenticationTag: null,
    keyVersion: null,
    credentialRevision: 0,
    credentialUpdatedAt: null,
    verificationStatus: "NEVER",
    lastVerifiedAt: null,
    lastVerificationCode: null,
    ...overrides,
  };
}

function buildService(options: {
  queryError?: Error;
  record?: NavConnectionSettingRecord;
}) {
  const record = options.record ?? setting();
  let persisted = false;
  let auditedCode: string | null = null;
  const envelope: NavCredentialEnvelope = {
    encryptedCredentials: Buffer.from("ciphertext"),
    encryptionIv: Buffer.alloc(12),
    authenticationTag: Buffer.alloc(16),
    keyVersion: "1",
  };
  const repository = {
    getSetting: async () => record,
    claimCooldown: async () => record,
    replaceCredential: async () => {
      persisted = true;
      return setting({
        credentialMode: "DATABASE",
        encryptedCredentials: envelope.encryptedCredentials,
        encryptionIv: envelope.encryptionIv,
        authenticationTag: envelope.authenticationTag,
        keyVersion: "1",
        credentialRevision: 1,
        credentialUpdatedAt: new Date("2026-07-30T10:00:00.000Z"),
        verificationStatus: "SUCCESS",
        lastVerifiedAt: new Date("2026-07-30T10:00:00.000Z"),
      });
    },
    auditCredentialValidationFailure: async (
      _actorUserId: string,
      code: string,
    ) => {
      auditedCode = code;
    },
    recordManualTest: async ({
      status,
      code,
    }: {
      status: "SUCCESS" | "FAILED";
      code: string | null;
    }) =>
      setting({
        ...record,
        verificationStatus: status,
        lastVerificationCode: code,
        lastVerifiedAt: new Date("2026-07-30T10:00:00.000Z"),
      }),
    disable: async () => setting({ credentialMode: "DISABLED" }),
  } as unknown as NavConnectionRepository;
  const crypto = {
    validateActiveKey: () => undefined,
    encrypt: () => envelope,
  } as unknown as NavCredentialCryptoService;
  const credentials = {
    serialize: () => JSON.stringify(input),
    resolveRecord: () => ({
      technicalUser: {
        login: input.technicalUserLogin,
        password: input.technicalUserPassword,
        taxNumber: input.technicalUserTaxNumber,
        signKey: input.technicalUserSignKey,
      },
      software: {
        softwareId: input.softwareId,
        softwareName: "Acropora OS",
        softwareOperation: "ONLINE_SERVICE" as const,
        softwareMainVersion: "1.0",
        softwareDevName: input.softwareDevName,
        softwareDevContact: input.softwareDevContact,
        softwareDevCountryCode: "HU",
        softwareDevTaxNumber: input.softwareDevTaxNumber,
      },
    }),
  } as unknown as NavCredentialsService;
  const client = {
    queryInvoiceDigest: async () => {
      if (options.queryError) throw options.queryError;
      return { currentPage: 1, availablePage: 1, items: [] };
    },
  } as unknown as NavOnlineInvoiceClient;

  return {
    service: new NavConnectionService(repository, crypto, credentials, client),
    wasPersisted: () => persisted,
    auditedCode: () => auditedCode,
  };
}

describe("NavConnectionService", () => {
  it("verifies before encrypting and persisting a replacement", async () => {
    const { service, wasPersisted } = buildService({});
    const result = await service.replaceCredential(
      input,
      "owner-1",
      new Date("2026-07-30T10:00:00.000Z"),
    );

    assert.equal(wasPersisted(), true);
    assert.equal(result.configured, true);
    assert.equal(result.masked, "••••••••");
    assert.equal(result.verification.status, "SUCCESS");
  });

  it("does not persist credentials rejected by NAV", async () => {
    const { service, wasPersisted, auditedCode } = buildService({
      queryError: new NavApiError("AUTH_REJECTED"),
    });

    await assert.rejects(
      service.replaceCredential(input, "owner-1"),
      (error: unknown) =>
        error instanceof Error &&
        error.message === "NAV_CONNECTION_AUTH_REJECTED",
    );
    assert.equal(wasPersisted(), false);
    assert.equal(auditedCode(), "NAV_CONNECTION_AUTH_REJECTED");
  });

  it("records a failed manual connection test without throwing", async () => {
    const { service } = buildService({
      queryError: new NavApiError("API_REJECTED"),
    });

    const result = await service.testStoredCredential(
      "owner-1",
      new Date("2026-07-30T10:00:00.000Z"),
    );
    assert.equal(result.verification.status, "FAILED");
    assert.equal(result.verification.code, "NAV_CONNECTION_API_REJECTED");
  });

  it("marks old verification state as stale", async () => {
    const { service } = buildService({
      record: setting({
        credentialMode: "DATABASE",
        encryptedCredentials: Buffer.from("ciphertext"),
        encryptionIv: Buffer.alloc(12),
        authenticationTag: Buffer.alloc(16),
        keyVersion: "1",
        verificationStatus: "SUCCESS",
        lastVerifiedAt: new Date("2026-07-28T10:00:00.000Z"),
      }),
    });

    const result = await service.get(new Date("2026-07-30T10:00:00.000Z"));
    assert.equal(result.verification.status, "STALE");
    assert.equal(result.verification.code, "NAV_CONNECTION_VERIFICATION_STALE");
  });
});

describe("normalizeNavCredentialInput", () => {
  it("accepts exactly the supported NAV credential fields", () => {
    assert.deepEqual(normalizeNavCredentialInput(input), input);
  });

  it("rejects malformed tax numbers and unexpected fields", () => {
    assert.throws(
      () =>
        normalizeNavCredentialInput({
          ...input,
          technicalUserTaxNumber: "23916229-2-42",
        }),
      /NAV_CREDENTIAL_INPUT_INVALID/,
    );
    assert.throws(
      () => normalizeNavCredentialInput({ ...input, exchangeKey: "unused" }),
      /NAV_CREDENTIAL_INPUT_INVALID/,
    );
  });
});
