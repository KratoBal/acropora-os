/**
 * Pure decision of which Bearer token (if any) a request should carry.
 * Kept separate from client.ts so it has zero dependency on `fetch`,
 * SecureStore or `@/config/env` — that makes it compilable and testable
 * with plain `tsc` + `node --test`, no Expo/React Native runtime needed.
 */
export interface ResolveRequestTokenOptions {
  /** Skip attaching any Authorization header, even if a token is stored
   * locally — used for the login request itself, so a stale or invalid
   * previously-stored token is never sent alongside new credentials. */
  skipAuth?: boolean;
  /** Explicit token to send instead of the one in storage — used only to
   * invalidate a just-issued session that failed to persist locally
   * (see sign-in.ts), before that token was ever saved. */
  authToken?: string;
  /** The token currently in SecureStore, or `null` if there is none. */
  storedToken: string | null;
}

export function resolveRequestToken(
  options: ResolveRequestTokenOptions,
): string | null {
  if (options.authToken) return options.authToken;
  if (options.skipAuth) return null;
  return options.storedToken;
}
