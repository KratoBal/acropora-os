import { createHash, randomBytes } from "node:crypto";

/**
 * 256 bits of entropy from Node's CSPRNG — comfortably more than enough to
 * make brute-forcing or guessing a live Bearer token infeasible, in line
 * with the OWASP session-ID-entropy guidance.
 */
const TOKEN_BYTES = 32;

/**
 * Generates a cryptographically secure, URL-safe Bearer token. `prefix` is
 * purely cosmetic (e.g. `dev_` so development tokens are visually
 * distinguishable in logs/devtools) — it carries no security meaning, the
 * actual development/production boundary is enforced by which endpoints
 * are reachable in which `NODE_ENV`.
 */
export function generateSessionToken(prefix = ""): string {
  return `${prefix}${randomBytes(TOKEN_BYTES).toString("base64url")}`;
}

/**
 * The database only ever stores this SHA-256 hash of a session token, never
 * the raw token — a stolen database dump alone is not enough to forge a
 * valid `Authorization: Bearer` header or session cookie.
 */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
