export declare const UNAS_CONNECTION_ID = "unas";
export declare const UNAS_VERIFICATION_STALE_MS: number;
export type UnasCredentialMode = "ENV_FALLBACK" | "DATABASE" | "DISABLED";
export type StoredUnasVerificationStatus = "NEVER" | "SUCCESS" | "FAILED" | "INDETERMINATE";
export type UnasVerificationStatus = StoredUnasVerificationStatus | "STALE";
export declare const UNAS_CONNECTION_ERROR_CODES: readonly ["UNAS_CONNECTION_CONFIGURATION_MISSING", "UNAS_CONNECTION_NOT_CONFIGURED", "UNAS_CONNECTION_DISABLED", "UNAS_CREDENTIAL_MASTER_KEY_NOT_CONFIGURED", "UNAS_CREDENTIAL_MASTER_KEY_INVALID", "UNAS_CREDENTIAL_KEY_VERSION_UNKNOWN", "UNAS_CREDENTIAL_ENVELOPE_INVALID", "UNAS_CREDENTIAL_DECRYPT_FAILED", "UNAS_CONNECTION_AUTH_REJECTED", "UNAS_CONNECTION_PERMISSION_MISSING", "UNAS_CONNECTION_PERMISSION_UNKNOWN", "UNAS_CONNECTION_VERIFICATION_STALE", "UNAS_CREDENTIAL_INPUT_INVALID", "UNAS_CONNECTION_RATE_LIMITED", "UNAS_CONNECTION_HTTP_4XX", "UNAS_CONNECTION_HTTP_5XX", "UNAS_CONNECTION_RATE_LIMITED_UPSTREAM", "UNAS_CONNECTION_TIMEOUT", "UNAS_CONNECTION_NETWORK_FAILED", "UNAS_CONNECTION_API_REJECTED", "UNAS_CONNECTION_RESPONSE_INVALID", "UNAS_CONNECTION_FAILED"];
export type UnasConnectionErrorCode = (typeof UNAS_CONNECTION_ERROR_CODES)[number];
export declare function isUnasConnectionErrorCode(value: unknown): value is UnasConnectionErrorCode;
export declare class UnasConnectionError extends Error {
    readonly code: UnasConnectionErrorCode;
    constructor(code: UnasConnectionErrorCode);
}
export interface UnasConnectionView {
    configured: boolean;
    masked: "••••••••" | null;
    modifiedAt: string | null;
    verification: {
        status: UnasVerificationStatus;
        checkedAt: string | null;
        code: UnasConnectionErrorCode | null;
    };
}
export interface UnasCredentialEnvelope {
    encryptedApiKey: Buffer;
    encryptionIv: Buffer;
    authenticationTag: Buffer;
    keyVersion: string;
}
export interface UnasConnectionSettingRecord {
    id: string;
    credentialMode: UnasCredentialMode;
    encryptedApiKey: Uint8Array | null;
    encryptionIv: Uint8Array | null;
    authenticationTag: Uint8Array | null;
    keyVersion: string | null;
    credentialRevision: number;
    credentialUpdatedAt: Date | null;
    verificationStatus: StoredUnasVerificationStatus;
    lastVerifiedAt: Date | null;
    lastVerificationCode: string | null;
}
