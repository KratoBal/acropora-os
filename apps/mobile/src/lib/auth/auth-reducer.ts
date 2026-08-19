import type { LockReason } from "./restore-session";
import type { AuthenticatedUser } from "./types";

export type AuthStatus =
  | "restoring"
  /**
   * A usable session is on disk, but the device did not confirm the
   * owner. Distinct from `unauthenticated` on purpose: there is still
   * something to unlock, so the UI can offer another attempt instead of
   * only a password form.
   */
  | "locked"
  | "unauthenticated"
  | "authenticated"
  | "signingIn"
  | "signingOut";

export interface AuthState {
  status: AuthStatus;
  user: AuthenticatedUser | null;
  expiresAt: string | null;
  /** True only while `status === "restoring"` and the last attempt to
   * reach `/auth/me` failed with a transient network error rather than an
   * auth rejection. The stored token is intentionally NOT cleared in this
   * case (see restore-session.ts) — the UI should show a retryable
   * connectivity state instead of bouncing to the login screen. */
  restoreNetworkError: boolean;
  /** Generic, non-revealing message for the last failed sign-in attempt. */
  signInError: string | null;
  /** Why the gate is shut, when `status === "locked"`. Drives what the
   * locked screen may offer: another attempt is only worth a button on a
   * device that has something to attempt. */
  lockReason: LockReason | null;
}

export const initialAuthState: AuthState = {
  status: "restoring",
  user: null,
  expiresAt: null,
  restoreNetworkError: false,
  signInError: null,
  lockReason: null,
};

export type AuthAction =
  | { type: "RESTORE_RETRY" }
  | { type: "RESTORE_UNAUTHENTICATED" }
  | {
      type: "RESTORE_AUTHENTICATED";
      user: AuthenticatedUser;
      expiresAt: string;
    }
  | { type: "RESTORE_NETWORK_ERROR" }
  /** `reason` is absent when the gate simply closed and nobody has been
   * asked yet - coming back to the foreground after a long absence. It is
   * present when an attempt ran and did not open it. */
  | { type: "SESSION_LOCKED"; reason?: LockReason }
  | { type: "SIGN_IN_START" }
  | { type: "SIGN_IN_SUCCESS"; user: AuthenticatedUser; expiresAt: string }
  | { type: "SIGN_IN_ERROR"; message: string }
  | { type: "SIGN_OUT_START" }
  | { type: "SIGN_OUT_DONE" };

export function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case "RESTORE_RETRY":
      return { ...initialAuthState, status: "restoring" };
    case "RESTORE_UNAUTHENTICATED":
      return { ...initialAuthState, status: "unauthenticated" };
    case "RESTORE_AUTHENTICATED":
      return {
        status: "authenticated",
        user: action.user,
        expiresAt: action.expiresAt,
        restoreNetworkError: false,
        signInError: null,
        lockReason: null,
      };
    case "RESTORE_NETWORK_ERROR":
      return { ...state, status: "restoring", restoreNetworkError: true };
    case "SESSION_LOCKED":
      // Nothing about the stored session changes here - only that it has
      // not been unlocked yet. The user is deliberately kept: when the
      // gate closes on a running app, remembering who is locked out is
      // what lets the way back in skip the server (see
      // resume-session.ts), and the screen can greet them by name instead
      // of showing an anonymous wall.
      return {
        ...state,
        status: "locked",
        lockReason: action.reason ?? null,
        restoreNetworkError: false,
        signInError: null,
      };
    case "SIGN_IN_START":
      return { ...state, status: "signingIn", signInError: null };
    case "SIGN_IN_SUCCESS":
      return {
        status: "authenticated",
        user: action.user,
        expiresAt: action.expiresAt,
        restoreNetworkError: false,
        signInError: null,
        lockReason: null,
      };
    case "SIGN_IN_ERROR":
      return {
        ...initialAuthState,
        status: "unauthenticated",
        signInError: action.message,
      };
    case "SIGN_OUT_START":
      return { ...state, status: "signingOut" };
    case "SIGN_OUT_DONE":
      return { ...initialAuthState, status: "unauthenticated" };
    default:
      return state;
  }
}
