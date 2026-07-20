export type UnasConnectionVerificationStatus =
  "NEVER" | "SUCCESS" | "FAILED" | "INDETERMINATE" | "STALE";

/**
 * Mirrors the API's UnasConnectionView response shape.
 *
 * The credential source (ENV_FALLBACK / DATABASE / DISABLED) is intentionally
 * not part of the contract: per ADR-014 the connection mode is treated as
 * credential-adjacent information and is never exposed to the client, only
 * whether a credential is configured and how it last verified.
 */
export interface UnasConnectionView {
  configured: boolean;
  masked: string | null;
  modifiedAt: string | null;
  verification: {
    status: UnasConnectionVerificationStatus;
    checkedAt: string | null;
    code: string | null;
  };
}
