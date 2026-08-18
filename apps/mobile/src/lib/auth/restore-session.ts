import type { AuthenticatedUser, StoredSession } from "./types";

/**
 * What a biometric unlock attempt concluded.
 *
 * - `unlocked`: the device confirmed the owner (Face ID, Touch ID, or the
 *   device passcode as the system's own fallback).
 * - `unavailable`: no biometric hardware, or nothing enrolled. Not a
 *   failure and not the user's doing.
 * - `rejected`: the attempt ran and did not succeed - cancelled, or
 *   failed too many times.
 */
export type UnlockOutcome = "unlocked" | "unavailable" | "rejected";

export interface RestoreSessionDeps {
  getSession(): Promise<StoredSession | null>;
  clearSession(): Promise<void>;
  getCurrentUser(): Promise<AuthenticatedUser>;
  /**
   * Biometric gate in front of the stored token. Optional: when absent,
   * the session restores exactly as it did before biometrics existed.
   * Kept as an injected shape - like `getSession` - so this module never
   * imports the Expo runtime and stays testable with plain `node --test`.
   */
  unlock?(): Promise<UnlockOutcome>;
  /** Injectable for deterministic tests; defaults to `Date.now`. */
  now?: () => number;
}

export type RestoreOutcome =
  | { type: "unauthenticated" }
  | { type: "authenticated"; user: AuthenticatedUser; expiresAt: string }
  | { type: "network-error" }
  /**
   * A usable session is on disk, but the owner was not confirmed. The
   * token is deliberately NOT discarded: a cancelled Face ID prompt says
   * nothing about whether the session is still valid. The UI should offer
   * another attempt, or signing in with the password instead.
   */
  | { type: "locked" };

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
 * 4. ask the device to confirm the owner (`unlock`), if a gate is wired
 *    up. This sits after the expiry check - there is no point asking for
 *    Face ID to unlock a session about to be thrown away - and before the
 *    network call, so the token never leaves the device until the person
 *    holding it has been confirmed;
 * 5. otherwise call `/auth/me` (`getCurrentUser`):
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

  if (deps.unlock) {
    const unlocked = await deps.unlock();
    if (unlocked === "rejected") {
      return { type: "locked" };
    }
    // `unavailable` deliberately falls through to the restore that
    // happened before biometrics existed. A device with no Face ID and no
    // passcode would otherwise lose its stored session on every launch -
    // a security-relevant behaviour change that belongs to the owner, not
    // to this function. See the open question in the handover notes.
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
