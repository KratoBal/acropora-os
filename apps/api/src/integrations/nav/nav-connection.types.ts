import type {
  NavConnectionCredentialInput,
  NavConnectionView,
} from "@acropora/types";
import { ServiceUnavailableException } from "@nestjs/common";

export const NAV_CONNECTION_ID = "nav";
export const NAV_VERIFICATION_STALE_MS = 24 * 60 * 60 * 1000;

export type NavCredentialMode = "ENV_FALLBACK" | "DATABASE" | "DISABLED";
export type StoredNavVerificationStatus = "NEVER" | "SUCCESS" | "FAILED";

export const NAV_CONNECTION_ERROR_CODES = [
  "NAV_CONNECTION_CONFIGURATION_MISSING",
  "NAV_CONNECTION_NOT_CONFIGURED",
  "NAV_CONNECTION_DISABLED",
  "NAV_CREDENTIAL_MASTER_KEY_NOT_CONFIGURED",
  "NAV_CREDENTIAL_MASTER_KEY_INVALID",
  "NAV_CREDENTIAL_KEY_VERSION_UNKNOWN",
  "NAV_CREDENTIAL_ENVELOPE_INVALID",
  "NAV_CREDENTIAL_DECRYPT_FAILED",
  "NAV_CREDENTIAL_INPUT_INVALID",
  "NAV_CONNECTION_RATE_LIMITED",
  "NAV_CONNECTION_AUTH_REJECTED",
  "NAV_CONNECTION_API_REJECTED",
  "NAV_CONNECTION_HTTP_4XX",
  "NAV_CONNECTION_HTTP_5XX",
  "NAV_CONNECTION_NETWORK_FAILED",
  "NAV_CONNECTION_TIMEOUT",
  "NAV_CONNECTION_RESPONSE_INVALID",
  "NAV_CONNECTION_FAILED",
  "NAV_CONNECTION_VERIFICATION_STALE",
] as const;

export type NavConnectionErrorCode =
  (typeof NAV_CONNECTION_ERROR_CODES)[number];

const ERROR_CODE_SET = new Set<string>(NAV_CONNECTION_ERROR_CODES);

export function isNavConnectionErrorCode(
  value: unknown,
): value is NavConnectionErrorCode {
  return typeof value === "string" && ERROR_CODE_SET.has(value);
}

export class NavConnectionError extends ServiceUnavailableException {
  constructor(readonly code: NavConnectionErrorCode) {
    super(code);
    this.name = "NavConnectionError";
  }
}

export interface NavCredentialEnvelope {
  encryptedCredentials: Buffer;
  encryptionIv: Buffer;
  authenticationTag: Buffer;
  keyVersion: string;
}

export interface NavConnectionSettingRecord {
  id: string;
  credentialMode: NavCredentialMode;
  encryptedCredentials: Uint8Array | null;
  encryptionIv: Uint8Array | null;
  authenticationTag: Uint8Array | null;
  keyVersion: string | null;
  credentialRevision: number;
  credentialUpdatedAt: Date | null;
  verificationStatus: StoredNavVerificationStatus;
  lastVerifiedAt: Date | null;
  lastVerificationCode: string | null;
}

export type StoredNavCredentials = NavConnectionCredentialInput;
export type { NavConnectionCredentialInput, NavConnectionView };
