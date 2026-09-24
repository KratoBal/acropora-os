/**
 * A Számlázz.hu Agent Key TÁROLÁSÁNAK típusai.
 *
 * A minta az UNAS és a Medusa kapcsolat-beállítása -- lásd
 * unas-credential-crypto.service.ts és medusa-connection.types.ts. Ez a kör
 * csak az Agent Key-t köti be (ADR-014, 4. szelet): a
 * `SzamlazzConnectionSetting.encryptedFinancialApiKey` négyes (az Online
 * Pénzügyi Adatkapcsolat kulcsa) ma nem használt, mert a piszkozat-előnézet
 * kizárólag az Agent API-t hívja.
 */

export const SZAMLAZZ_CONNECTION_ID = "szamlazz";

/**
 * `ENV_FALLBACK` az induló állapot, ugyanúgy, mint a UNAS és a Medusa
 * kapcsolatnál -- itt viszont NINCS tervezett plaintext env-kulcs (a
 * `SZAMLAZZ_AGENT_KEY` a `.env.example`-ben szándékosan üres marad): az
 * Agent Key kizárólag a Beállítások-oldalon, titkosítva kerül be. Ha ez a
 * mód mégis aktív marad kulcs nélkül, az eredmény `not-configured`, nem
 * hiba -- pontosan úgy, ahogy a Medusa is viselkedik `MEDUSA_ADMIN_API_KEY`
 * nélkül.
 */
export type SzamlazzCredentialMode = "ENV_FALLBACK" | "DATABASE" | "DISABLED";

export type StoredSzamlazzVerificationStatus =
  "NEVER" | "SUCCESS" | "FAILED" | "INDETERMINATE";

export const SZAMLAZZ_CONNECTION_ERROR_CODES = [
  "SZAMLAZZ_CONNECTION_CONFIGURATION_MISSING",
  "SZAMLAZZ_CONNECTION_NOT_CONFIGURED",
  "SZAMLAZZ_CONNECTION_DISABLED",
  "SZAMLAZZ_CREDENTIAL_MASTER_KEY_NOT_CONFIGURED",
  "SZAMLAZZ_CREDENTIAL_MASTER_KEY_INVALID",
  "SZAMLAZZ_CREDENTIAL_KEY_VERSION_UNKNOWN",
  "SZAMLAZZ_CREDENTIAL_ENVELOPE_INVALID",
  "SZAMLAZZ_CREDENTIAL_DECRYPT_FAILED",
  "SZAMLAZZ_CREDENTIAL_INPUT_INVALID",
  /**
   * Ugyanaz a szerep, mint a Medusa visszatartásánál: a kérést a
   * visszatartás fogta meg, nem hiba a kulcsban. A teendő várni, nem
   * javítani.
   */
  "SZAMLAZZ_CONNECTION_COOLDOWN",
] as const;

export type SzamlazzConnectionErrorCode =
  (typeof SZAMLAZZ_CONNECTION_ERROR_CODES)[number];

const SZAMLAZZ_CONNECTION_ERROR_CODE_SET = new Set<string>(
  SZAMLAZZ_CONNECTION_ERROR_CODES,
);

export function isSzamlazzConnectionErrorCode(
  value: unknown,
): value is SzamlazzConnectionErrorCode {
  return (
    typeof value === "string" && SZAMLAZZ_CONNECTION_ERROR_CODE_SET.has(value)
  );
}

export class SzamlazzConnectionError extends Error {
  constructor(readonly code: SzamlazzConnectionErrorCode) {
    super(code);
    this.name = "SzamlazzConnectionError";
  }
}

export interface SzamlazzCredentialEnvelope {
  encryptedAgentKey: Buffer;
  encryptionIv: Buffer;
  authenticationTag: Buffer;
  keyVersion: string;
}

export interface SzamlazzConnectionSettingRecord {
  id: string;
  credentialMode: SzamlazzCredentialMode;
  encryptedAgentKey: Uint8Array | null;
  agentKeyEncryptionIv: Uint8Array | null;
  agentKeyAuthenticationTag: Uint8Array | null;
  agentKeyVersion: string | null;
  credentialRevision: number;
  credentialUpdatedAt: Date | null;
  credentialUpdatedByUserId: string | null;
  credentialAttemptedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
