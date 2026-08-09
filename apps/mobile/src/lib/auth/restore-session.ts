import type { AuthenticatedUser, StoredSession } from "./types";

export interface RestoreSessionDeps {
  getSession(): Promise<StoredSession | null>;
  clearSession(): Promise<void>;
  getCurrentUser(): Promise<AuthenticatedUser>;
  /** Injectable for deterministic tests; defaults to `Date.now`. */
  now?: () => number;
}

export type RestoreOutcome =
  | { type: "unauthenticated" }
  | { type: "authenticated"; user: AuthenticatedUser; expiresAt: string }
  | { type: "network-error" };

/**
 * Duck-types the one thing restore-session.ts needs to know about a
 * failed `getCurrentUser()` call — "was this an HTTP 401?" — without
 * importing apps/mobile/src/lib/api/client.ts's `ApiError` class. Keeping
 * this module free of any import from the fetch/SecureStore/env-reading
 * layer is what makes it compilable and testable with plain `tsc` +
 * `node --test`, no Expo/React Native runtime required.
 */
function isUnauthorized(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status?: unknown }).status === 401
  );
}

/**
 * App-startup session restore, per the checkpoint spec:
 * 1. read the token from SecureStore (via `getSession`);
 * 2. no token -> unauthenticated;
 * 3. token present but its own `expiresAt` has already passed -> discard
 *    it locally without ever calling the server;
 * 4. otherwise call `/auth/me` (`getCurrentUser`):
 *    - success -> authenticated, with the restored user;
 *    - 401 -> the token is genuinely invalid server-side, discard it;
 *    - anything else (network failure, 5xx, timeout) -> treat as
 *      transient: do NOT discard an otherwise-valid token, report
 *      "network-error" so the UI can offer a retry instead of forcing a
 *      re-login.
 */
export async function restoreSession(
  deps: RestoreSessionDeps,
): Promise<RestoreOutcome> {
  const now = deps.now ?? Date.now;
  const session = await deps.getSession();

  if (!session) {
    return { type: "unauthenticated" };
  }

  if (new Date(session.expiresAt).getTime() <= now()) {
    await deps.clearSession();
    return { type: "unauthenticated" };
  }

  try {
    const user = await deps.getCurrentUser();
    return { type: "authenticated", user, expiresAt: session.expiresAt };
  } catch (error) {
    if (isUnauthorized(error)) {
      await deps.clearSession();
      return { type: "unauthenticated" };
    }
    return { type: "network-error" };
  }
}
