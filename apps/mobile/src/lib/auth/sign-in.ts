import type { AuthenticatedUser, LoginResult, StoredSession } from "./types";

export interface SignInDeps {
  loginWithPassword(email: string, password: string): Promise<LoginResult>;
  saveSession(session: StoredSession): Promise<void>;
  /** Invalidates a token server-side by explicit value, used only when a
   * freshly issued session could not be persisted locally — see below. */
  invalidateToken(token: string): Promise<void>;
}

export type SignInOutcome =
  | { type: "success"; user: AuthenticatedUser; expiresAt: string }
  | { type: "invalid-credentials"; message: string }
  | { type: "network-error"; message: string }
  | { type: "error"; message: string };

const INVALID_CREDENTIALS_MESSAGE = "Hibás e-mail cím vagy jelszó.";
const NETWORK_ERROR_MESSAGE =
  "Nem sikerült kapcsolódni a szerverhez. Ellenőrizd az internetkapcsolatot, majd próbáld újra.";
const MALFORMED_RESPONSE_MESSAGE =
  "A szerver váratlan választ adott. Próbáld újra.";
const SAVE_FAILED_MESSAGE =
  "A bejelentkezés nem menthető el ezen az eszközön. Próbáld újra.";

function isUnauthorized(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status?: unknown }).status === 401
  );
}

function isValidLoginResult(result: LoginResult | undefined | null): result is LoginResult {
  return (
    !!result &&
    typeof result.token === "string" &&
    result.token.length > 0 &&
    typeof result.expiresAt === "string" &&
    result.expiresAt.length > 0 &&
    !!result.user &&
    typeof result.user.id === "string" &&
    result.user.id.length > 0
  );
}

/**
 * Password sign-in, per the checkpoint spec:
 * 1. call the login endpoint (the caller is responsible for not attaching
 *    any stale Authorization header to this request — see
 *    apps/mobile/src/lib/api/request-auth.ts);
 * 2. validate the minimally required response fields before touching any
 *    storage — a malformed response must never leave the app
 *    half-authenticated;
 * 3. persist the token; only after that succeeds does the caller move to
 *    the authenticated state;
 * 4. if persisting fails, invalidate the just-issued server session (best
 *    effort) so no orphaned session survives, and report a clear error
 *    instead of silently continuing.
 *
 * Every failure path returns a fixed, generic message — never the
 * underlying error's own message — so neither a token nor any detail that
 * could narrow down "was it the e-mail or the password" ever reaches the
 * UI, a log, or a thrown error's `.message`.
 */
export async function signIn(
  deps: SignInDeps,
  email: string,
  password: string,
): Promise<SignInOutcome> {
  let result: LoginResult;
  try {
    result = await deps.loginWithPassword(email, password);
  } catch (error) {
    if (isUnauthorized(error)) {
      return { type: "invalid-credentials", message: INVALID_CREDENTIALS_MESSAGE };
    }
    return { type: "network-error", message: NETWORK_ERROR_MESSAGE };
  }

  if (!isValidLoginResult(result)) {
    return { type: "error", message: MALFORMED_RESPONSE_MESSAGE };
  }

  try {
    await deps.saveSession({ token: result.token, expiresAt: result.expiresAt });
  } catch {
    await deps.invalidateToken(result.token).catch(() => undefined);
    return { type: "error", message: SAVE_FAILED_MESSAGE };
  }

  return { type: "success", user: result.user, expiresAt: result.expiresAt };
}
