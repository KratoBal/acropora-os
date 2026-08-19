import type { UnlockOutcome } from "./restore-session";
import type { AuthenticatedUser, StoredSession } from "./types";

export interface ResumeSessionDeps {
  getSession(): Promise<StoredSession | null>;
  clearSession(): Promise<void>;
  unlock(): Promise<UnlockOutcome>;
  /** Injectable for deterministic tests; defaults to `Date.now`. */
  now?: () => number;
}

export type ResumeOutcome =
  | { type: "unauthenticated" }
  | { type: "authenticated"; user: AuthenticatedUser; expiresAt: string }
  | { type: "locked"; reason: Exclude<UnlockOutcome, "unlocked"> };

/**
 * Returning to a session the app already had, after the gate closed on a
 * trip to the background.
 *
 * The difference from `restoreSession` is one deliberate omission: **this
 * does not call the server.** A successful unlock plus a token that has
 * not locally expired is enough to carry on.
 *
 * That is the owner's decision (2026-08-18), and it has a price worth
 * writing down so nobody later reads it as a missing check and "fixes"
 * it: on the way back from the background we do not learn that the
 * session was revoked server-side. The next real request will find out.
 *
 * The reason it is worth paying: the app is used in basements, plant
 * rooms and roof spaces with no signal. Requiring the server here would
 * mean that coming back to the app after fifteen minutes locks a
 * technician out of a session that is valid and sitting on their own
 * phone. Revocation is rare; walking out of coverage is the daily case.
 * A cold start still checks with the server, so the window is bounded by
 * how long the app stays running.
 */
export async function resumeSession(
  deps: ResumeSessionDeps,
  user: AuthenticatedUser,
): Promise<ResumeOutcome> {
  const now = deps.now ?? Date.now;
  const session = await deps.getSession();

  if (!session) {
    return { type: "unauthenticated" };
  }

  // Checked before the prompt: there is no point asking for Face ID to
  // reopen a session that is being thrown away either way.
  if (new Date(session.expiresAt).getTime() <= now()) {
    await deps.clearSession();
    return { type: "unauthenticated" };
  }

  const unlocked = await deps.unlock();
  if (unlocked !== "unlocked") {
    return { type: "locked", reason: unlocked };
  }

  return { type: "authenticated", user, expiresAt: session.expiresAt };
}
