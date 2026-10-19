import { createHash, createPublicKey, verify } from "node:crypto";

/**
 * THE GOOGLE AND APPLE ID TOKENS, CHECKED WITHOUT A LIBRARY (plan v6.1, 3.2:
 * "signature, issuer, audience and expiry checked"; slice 3).
 *
 * Both providers sign with RS256 and publish their keys as a JWK set, so
 * `node:crypto` does the whole check: the key is imported from its JWK, the
 * signature is verified over `header.payload`, and the claims are compared
 * here. No new dependency, and nothing in the token decides HOW it is checked:
 * the algorithm is fixed to RS256, the issuers and audiences come from our
 * configuration, never from the token.
 *
 * WHAT A PASS MEANS: the provider signed these claims for one of OUR client
 * ids, recently. It does not mean the e-mail in it is verified; that is a
 * separate claim the caller reads (`emailVerified`).
 */

export type ReefClubProvider = "GOOGLE" | "APPLE";

export interface ReefClubProviderConfig {
  provider: ReefClubProvider;
  /** Accepted `iss` values. */
  issuers: readonly string[];
  /** Our client ids; a token for any other `aud` is refused. */
  audiences: readonly string[];
  /** The provider's public JWK set. */
  jwksUrl: string;
}

export const GOOGLE_ISSUERS = [
  "https://accounts.google.com",
  "accounts.google.com",
] as const;
export const APPLE_ISSUERS = ["https://appleid.apple.com"] as const;
export const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
export const APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys";

/** The clock difference tolerated on `exp` and `iat`, in seconds. */
export const CLOCK_SKEW_SECONDS = 60;
/** A longer token is not an ID token; the ceiling also bounds the work. */
export const ID_TOKEN_MAX_LENGTH = 8192;

export interface ReefClubIdClaims {
  provider: ReefClubProvider;
  subject: string;
  /** Lower-cased and trimmed, or null when the token carries none. */
  email: string | null;
  emailVerified: boolean;
  nonce: string | null;
}

/** Why a token was refused. The caller answers the same way for every code. */
export type ReefClubIdTokenFailure =
  | "MALFORMED"
  | "ALGORITHM"
  | "UNKNOWN_KEY"
  | "SIGNATURE"
  | "ISSUER"
  | "AUDIENCE"
  | "EXPIRED"
  | "NOT_YET_VALID"
  | "SUBJECT";

export class ReefClubIdTokenError extends Error {
  constructor(readonly failure: ReefClubIdTokenFailure) {
    super(failure);
    this.name = "ReefClubIdTokenError";
  }
}

/** A public key of a provider's JWK set, with its key id. */
export type ReefClubJwk = JsonWebKey & { kid?: string };

/** Returns the key with this `kid`, or null if the provider has none. */
export type ReefClubKeyLookup = (
  config: ReefClubProviderConfig,
  kid: string,
) => Promise<ReefClubJwk | null>;

export async function verifyIdToken(
  token: string,
  config: ReefClubProviderConfig,
  keyFor: ReefClubKeyLookup,
  now: Date = new Date(),
): Promise<ReefClubIdClaims> {
  if (token.length > ID_TOKEN_MAX_LENGTH)
    throw new ReefClubIdTokenError("MALFORMED");
  const parts = token.split(".");
  if (parts.length !== 3) throw new ReefClubIdTokenError("MALFORMED");
  const [headerPart, payloadPart, signaturePart] = parts as [
    string,
    string,
    string,
  ];
  const header = decodeJson(headerPart);
  const payload = decodeJson(payloadPart);

  // Fixed, not read from the token: "none" and HS256 (a public key used as an
  // HMAC secret) are the classic ways a token picks its own check.
  if (header.alg !== "RS256") throw new ReefClubIdTokenError("ALGORITHM");
  if (typeof header.kid !== "string" || header.kid.length === 0)
    throw new ReefClubIdTokenError("UNKNOWN_KEY");
  const jwk = await keyFor(config, header.kid);
  if (!jwk || jwk.kty !== "RSA") throw new ReefClubIdTokenError("UNKNOWN_KEY");

  let signatureOk = false;
  try {
    signatureOk = verify(
      "RSA-SHA256",
      Buffer.from(`${headerPart}.${payloadPart}`),
      createPublicKey({ key: jwk, format: "jwk" }),
      Buffer.from(signaturePart, "base64url"),
    );
  } catch {
    signatureOk = false;
  }
  if (!signatureOk) throw new ReefClubIdTokenError("SIGNATURE");

  if (typeof payload.iss !== "string" || !config.issuers.includes(payload.iss))
    throw new ReefClubIdTokenError("ISSUER");
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (
    config.audiences.length === 0 ||
    !audiences.some(
      (aud) => typeof aud === "string" && config.audiences.includes(aud),
    )
  )
    throw new ReefClubIdTokenError("AUDIENCE");
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (
    typeof payload.exp !== "number" ||
    payload.exp + CLOCK_SKEW_SECONDS <= nowSeconds
  )
    throw new ReefClubIdTokenError("EXPIRED");
  if (
    typeof payload.iat === "number" &&
    payload.iat - CLOCK_SKEW_SECONDS > nowSeconds
  )
    throw new ReefClubIdTokenError("NOT_YET_VALID");
  if (
    typeof payload.sub !== "string" ||
    payload.sub.length === 0 ||
    payload.sub.length > 255
  )
    throw new ReefClubIdTokenError("SUBJECT");

  return {
    provider: config.provider,
    subject: payload.sub,
    email:
      typeof payload.email === "string" && payload.email.trim().length > 0
        ? payload.email.trim().toLowerCase()
        : null,
    // Google sends a boolean, Apple has sent the string "true" as well.
    emailVerified:
      payload.email_verified === true || payload.email_verified === "true",
    nonce: typeof payload.nonce === "string" ? payload.nonce : null,
  };
}

/**
 * THE APPLE NONCE: the client sends the raw nonce, the token must carry its
 * SHA-256 (hex), which is what the native Apple sign-in puts in it and what
 * the web flow puts in it when the hash is passed. Only this one form is
 * accepted: accepting the raw value too would let anybody who holds the token
 * (and so its nonce claim) send that claim back as "the raw nonce".
 */
export function appleNonceMatches(
  claims: ReefClubIdClaims,
  rawNonce: string,
): boolean {
  if (!claims.nonce) return false;
  const expected = createHash("sha256").update(rawNonce).digest("hex");
  return claims.nonce === expected;
}

function decodeJson(part: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(
      Buffer.from(part, "base64url").toString("utf8"),
    );
    if (value && typeof value === "object" && !Array.isArray(value))
      return value as Record<string, unknown>;
  } catch {
    /* falls through */
  }
  throw new ReefClubIdTokenError("MALFORMED");
}
