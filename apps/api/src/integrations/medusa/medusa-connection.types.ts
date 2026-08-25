/**
 * A Medusa admin kulcs TÁROLÁSÁNAK típusai.
 *
 * Ez a kör a hitelesítő adat HELYÉT építi meg, nem a hívást. A minta az UNAS
 * és a NAV kapcsolat-beállítása, és ez SZÁNDÉKOSAN MÁSOLAT, nem kiemelés: a
 * három integráció titkosítója külön él, amíg valaki külön körben nem dönt a
 * közös szolgáltatásról. Egy kiemelés két élesben futó integrációt írna át.
 */

export const MEDUSA_CONNECTION_ID = "medusa";

/**
 * `ENV_FALLBACK` az induló állapot, mert a vetítés ma a folyamat környezetéből
 * kapja a kulcsot. A tartalék NEM néma: a hívó oldalnak ki kell mondania, ha
 * ezen az úton megy, különben egy átmenetből észrevétlenül állapot lesz.
 */
export type MedusaCredentialMode = "ENV_FALLBACK" | "DATABASE" | "DISABLED";

export type StoredMedusaVerificationStatus =
  "NEVER" | "SUCCESS" | "FAILED" | "INDETERMINATE";

export type MedusaVerificationStatus = StoredMedusaVerificationStatus | "STALE";

export const MEDUSA_VERIFICATION_STALE_MS = 24 * 60 * 60 * 1000;

/**
 * Ebben a körben CSAK a tárolás hibakódjai állnak itt. A hívás állapotai (a
 * hitelesítési vagy jogosultsági bukás közös állapota, a degradált integráció)
 * a következő körben kerülnek ide, amikor a modul is megépül.
 */
export const MEDUSA_CONNECTION_ERROR_CODES = [
  "MEDUSA_CONNECTION_CONFIGURATION_MISSING",
  "MEDUSA_CONNECTION_NOT_CONFIGURED",
  "MEDUSA_CONNECTION_DISABLED",
  "MEDUSA_CREDENTIAL_MASTER_KEY_NOT_CONFIGURED",
  "MEDUSA_CREDENTIAL_MASTER_KEY_INVALID",
  "MEDUSA_CREDENTIAL_KEY_VERSION_UNKNOWN",
  "MEDUSA_CREDENTIAL_ENVELOPE_INVALID",
  "MEDUSA_CREDENTIAL_DECRYPT_FAILED",
  "MEDUSA_CREDENTIAL_INPUT_INVALID",
] as const;

export type MedusaConnectionErrorCode =
  (typeof MEDUSA_CONNECTION_ERROR_CODES)[number];

const MEDUSA_CONNECTION_ERROR_CODE_SET = new Set<string>(
  MEDUSA_CONNECTION_ERROR_CODES,
);

export function isMedusaConnectionErrorCode(
  value: unknown,
): value is MedusaConnectionErrorCode {
  return (
    typeof value === "string" && MEDUSA_CONNECTION_ERROR_CODE_SET.has(value)
  );
}

export class MedusaConnectionError extends Error {
  constructor(readonly code: MedusaConnectionErrorCode) {
    super(code);
    this.name = "MedusaConnectionError";
  }
}

/**
 * Amit a felület KAPHAT. A kulcs maga nincs benne, és nem is lesz: beállítás
 * után felülírni, tesztelni és letiltani lehet, visszaolvasni nem.
 */
export interface MedusaConnectionView {
  configured: boolean;
  masked: "••••••••" | null;
  modifiedAt: string | null;
  verification: {
    status: MedusaVerificationStatus;
    checkedAt: string | null;
    code: MedusaConnectionErrorCode | null;
  };
}

export interface MedusaCredentialEnvelope {
  encryptedApiKey: Buffer;
  encryptionIv: Buffer;
  authenticationTag: Buffer;
  keyVersion: string;
}

export interface MedusaConnectionSettingRecord {
  id: string;
  credentialMode: MedusaCredentialMode;
  encryptedApiKey: Uint8Array | null;
  encryptionIv: Uint8Array | null;
  authenticationTag: Uint8Array | null;
  keyVersion: string | null;
  credentialRevision: number;
  credentialUpdatedAt: Date | null;
  credentialUpdatedByUserId: string | null;
  verificationStatus: StoredMedusaVerificationStatus;
  lastVerifiedAt: Date | null;
  lastVerificationCode: string | null;
  credentialAttemptedAt: Date | null;
  testAttemptedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
