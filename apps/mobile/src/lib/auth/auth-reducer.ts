import type { AuthenticatedUser } from "./types";

export type AuthStatus =
  | "restoring"
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
}

export const initialAuthState: AuthState = {
  status: "restoring",
  user: null,
  expiresAt: null,
  restoreNetworkError: false,
  signInError: null,
};

export type AuthAction =
  | { type: "RESTORE_RETRY" }
  | { type: "RESTORE_UNAUTHENTICATED" }
  | { type: "RESTORE_AUTHENTICATED"; user: AuthenticatedUser; expiresAt: string }
  | { type: "RESTORE_NETWORK_ERROR" }
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
      };
    case "RESTORE_NETWORK_ERROR":
      return { ...state, status: "restoring", restoreNetworkError: true };
    case "SIGN_IN_START":
      return { ...state, status: "signingIn", signInError: null };
    case "SIGN_IN_SUCCESS":
      return {
        status: "authenticated",
        user: action.user,
        expiresAt: action.expiresAt,
        restoreNetworkError: false,
        signInError: null,
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
