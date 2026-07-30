import { Injectable } from "@nestjs/common";
import type { NavConnectionCredentialInput } from "@acropora/types";

import { NavConnectionRepository } from "./nav-connection.repository.js";
import {
  NavConnectionError,
  type NavConnectionSettingRecord,
  type NavCredentialEnvelope,
  type StoredNavCredentials,
} from "./nav-connection.types.js";
import { NavCredentialCryptoService } from "./nav-credential-crypto.service.js";
import type { NavSoftwareData, NavTechnicalUser } from "./nav-xml.util.js";

export interface ResolvedNavCredentials {
  technicalUser: NavTechnicalUser;
  software: NavSoftwareData;
  revision: string;
}

const INPUT_KEYS = [
  "technicalUserLogin",
  "technicalUserPassword",
  "technicalUserTaxNumber",
  "technicalUserSignKey",
  "softwareId",
  "softwareDevName",
  "softwareDevContact",
  "softwareDevTaxNumber",
] as const satisfies ReadonlyArray<keyof NavConnectionCredentialInput>;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new NavConnectionError("NAV_CONNECTION_NOT_CONFIGURED");
  return value;
}

function requiredText(
  input: Record<string, unknown>,
  key: (typeof INPUT_KEYS)[number],
  maxLength: number,
): string {
  const value = input[key];
  if (typeof value !== "string")
    throw new NavConnectionError("NAV_CREDENTIAL_INPUT_INVALID");
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength)
    throw new NavConnectionError("NAV_CREDENTIAL_INPUT_INVALID");
  return trimmed;
}

export function normalizeNavCredentialInput(
  value: unknown,
): NavConnectionCredentialInput {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new NavConnectionError("NAV_CREDENTIAL_INPUT_INVALID");
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input).sort();
  if (
    keys.length !== INPUT_KEYS.length ||
    !INPUT_KEYS.every((key) => keys.includes(key))
  )
    throw new NavConnectionError("NAV_CREDENTIAL_INPUT_INVALID");

  const normalized: NavConnectionCredentialInput = {
    technicalUserLogin: requiredText(input, "technicalUserLogin", 100),
    technicalUserPassword: requiredText(input, "technicalUserPassword", 256),
    technicalUserTaxNumber: requiredText(input, "technicalUserTaxNumber", 8),
    technicalUserSignKey: requiredText(input, "technicalUserSignKey", 512),
    softwareId: requiredText(input, "softwareId", 18),
    softwareDevName: requiredText(input, "softwareDevName", 512),
    softwareDevContact: requiredText(input, "softwareDevContact", 512),
    softwareDevTaxNumber: requiredText(input, "softwareDevTaxNumber", 8),
  };
  if (
    !/^\d{8}$/.test(normalized.technicalUserTaxNumber) ||
    !/^\d{8}$/.test(normalized.softwareDevTaxNumber) ||
    normalized.softwareId.length !== 18
  )
    throw new NavConnectionError("NAV_CREDENTIAL_INPUT_INVALID");
  return normalized;
}

/// Közös, adatbázis-első NAV credential provider a queryTaxpayer,
/// queryInvoiceDigest/queryInvoiceData és a kapcsolat-teszt számára.
@Injectable()
export class NavCredentialsService {
  constructor(
    private readonly repository: NavConnectionRepository,
    private readonly crypto: NavCredentialCryptoService,
  ) {}

  async resolve(): Promise<ResolvedNavCredentials> {
    const setting = await this.repository.getSetting();
    if (!setting)
      throw new NavConnectionError("NAV_CONNECTION_CONFIGURATION_MISSING");
    return this.resolveRecord(setting);
  }

  resolveRecord(setting: NavConnectionSettingRecord): ResolvedNavCredentials {
    if (setting.credentialMode === "DISABLED")
      throw new NavConnectionError("NAV_CONNECTION_DISABLED");
    const input =
      setting.credentialMode === "DATABASE"
        ? this.databaseCredentials(setting)
        : this.environmentCredentials();
    return this.toResolved(
      input,
      setting.credentialMode === "DATABASE"
        ? `database:${setting.credentialRevision}`
        : "environment",
    );
  }

  serialize(input: NavConnectionCredentialInput): string {
    return JSON.stringify(input satisfies StoredNavCredentials);
  }

  validateRecord(setting: NavConnectionSettingRecord): void {
    if (setting.credentialMode === "DISABLED") return;
    void this.resolveRecord(setting);
  }

  private environmentCredentials(): NavConnectionCredentialInput {
    return normalizeNavCredentialInput({
      technicalUserLogin: requiredEnv("NAV_TECHNICAL_USER_LOGIN"),
      technicalUserPassword: requiredEnv("NAV_TECHNICAL_USER_PASSWORD"),
      technicalUserTaxNumber: requiredEnv("NAV_TECHNICAL_USER_TAX_NUMBER"),
      technicalUserSignKey: requiredEnv("NAV_TECHNICAL_USER_SIGN_KEY"),
      softwareId: requiredEnv("NAV_SOFTWARE_ID"),
      softwareDevName: requiredEnv("NAV_SOFTWARE_DEV_NAME"),
      softwareDevContact: requiredEnv("NAV_SOFTWARE_DEV_CONTACT"),
      softwareDevTaxNumber: requiredEnv("NAV_SOFTWARE_DEV_TAX_NUMBER"),
    });
  }

  private databaseCredentials(
    setting: NavConnectionSettingRecord,
  ): NavConnectionCredentialInput {
    const envelope = this.databaseEnvelope(setting);
    let parsed: unknown;
    try {
      parsed = JSON.parse(
        this.crypto.decrypt(envelope, setting.credentialRevision),
      );
    } catch (error) {
      if (error instanceof NavConnectionError) throw error;
      throw new NavConnectionError("NAV_CREDENTIAL_DECRYPT_FAILED");
    }
    try {
      return normalizeNavCredentialInput(parsed);
    } catch {
      throw new NavConnectionError("NAV_CREDENTIAL_ENVELOPE_INVALID");
    }
  }

  private databaseEnvelope(
    setting: NavConnectionSettingRecord,
  ): NavCredentialEnvelope {
    if (
      !setting.encryptedCredentials ||
      !setting.encryptionIv ||
      !setting.authenticationTag ||
      !setting.keyVersion
    )
      throw new NavConnectionError("NAV_CREDENTIAL_ENVELOPE_INVALID");
    return {
      encryptedCredentials: Buffer.from(setting.encryptedCredentials),
      encryptionIv: Buffer.from(setting.encryptionIv),
      authenticationTag: Buffer.from(setting.authenticationTag),
      keyVersion: setting.keyVersion,
    };
  }

  private toResolved(
    input: NavConnectionCredentialInput,
    revision: string,
  ): ResolvedNavCredentials {
    return {
      technicalUser: {
        login: input.technicalUserLogin,
        password: input.technicalUserPassword,
        taxNumber: input.technicalUserTaxNumber,
        signKey: input.technicalUserSignKey,
      },
      software: {
        softwareId: input.softwareId,
        softwareName: process.env.NAV_SOFTWARE_NAME?.trim() || "Acropora OS",
        softwareOperation: "ONLINE_SERVICE",
        softwareMainVersion: process.env.NAV_SOFTWARE_VERSION?.trim() || "1.0",
        softwareDevName: input.softwareDevName,
        softwareDevContact: input.softwareDevContact,
        softwareDevCountryCode:
          process.env.NAV_SOFTWARE_DEV_COUNTRY_CODE?.trim() || "HU",
        softwareDevTaxNumber: input.softwareDevTaxNumber,
      },
      revision,
    };
  }
}
