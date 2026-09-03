import { canStartOffline } from "./offline-grace";
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

/**
 * Why the gate stayed shut. Both end at the password form - the owner's
 * decision - but they differ in one visible way: offering "try Face ID
 * again" to a phone that has no Face ID is a button that cannot work.
 */
export type LockReason = "rejected" | "unavailable";

export type RestoreOutcome =
  | { type: "unauthenticated" }
  | { type: "authenticated"; user: AuthenticatedUser; expiresAt: string }
  | { type: "network-error" }
  /**
   * NINCS HALOZAT, DE A TAROLT MUNKAMENET MEG HIHETO.
   *
   * Balazs dontese (2026-09-02): legfeljebb 24 oraig. A hatart es az arat a
   * `offline-grace.ts` hordozza; ez az ag csak akkor all elo, ha ott ENGED.
   *
   * A felhasznalo a LEMEZROL jon, nem a szervertol -- ezert kell a profilt a
   * munkamenettel egyutt tarolni. Enelkul a kapu eldontheto lenne, de nem
   * megvalosithato: nincs mit visszaadni.
   */
  | {
      type: "authenticated-offline";
      user: AuthenticatedUser;
      expiresAt: string;
      /** Hany ezredmasodperce volt az utolso sikeres szerver-ellenorzes. */
      verifiedAgeMs: number;
    }
  /**
   * A usable session is on disk, but the owner was not confirmed. The
   * token is deliberately NOT discarded: a cancelled Face ID prompt says
   * nothing about whether the session is still valid. The UI should offer
   * another attempt, or signing in with the password instead.
   */
  | { type: "locked"; reason: LockReason };

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
    // A device that cannot offer biometrics is treated the same as one
    // that refused them: the owner decided that both fall back to the
    // password rather than to an unguarded restore. The reason is carried
    // out so the UI can tell "try again" apart from "there is nothing to
    // try".
    const unlocked = await deps.unlock();
    if (unlocked !== "unlocked") {
      return { type: "locked", reason: unlocked };
    }
  }

  try {
    const user = await deps.getCurrentUser();
    return { type: "authenticated", user, expiresAt: session.expiresAt };
  } catch (error) {
    if (isUnauthorized(error)) {
      await deps.clearSession();
      return { type: "unauthenticated" };
    }
    /**
     * A HALOZATI HIBA MOSTANTOL KET DOLGOT JELENTHET, ES A KULONBSEG A TAROLT
     * ADATON MULIK, NEM A HIBAN.
     *
     * Ha van profil ES az utolso sikeres ellenorzes a 24 oras ablakon belul
     * van, az app elindulhat offline. Ha barmelyik hianyzik, marad a regi
     * viselkedes: `network-error`, es a felulet ujraprobalast kinal.
     *
     * A HIANYZO ADAT NEM BEENGEDES -- a `canStartOffline` `never-verified` aga
     * epp ezert all ott, es epp ezert nem `??`-al oldjuk fel.
     */
    if (session.user) {
      const verdict = canStartOffline({
        lastVerifiedAt: session.lastVerifiedAt ?? null,
        now: now(),
      });
      if (verdict.allowed) {
        return {
          type: "authenticated-offline",
          user: session.user,
          expiresAt: session.expiresAt,
          verifiedAgeMs: verdict.ageMs,
        };
      }
    }
    return { type: "network-error" };
  }
}
