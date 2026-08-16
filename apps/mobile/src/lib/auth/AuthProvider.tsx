import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  getCurrentUser,
  invalidateToken,
  loginWithPassword,
  logout as logoutRequest,
} from "./api";
import { authReducer, initialAuthState, type AuthState } from "./auth-reducer";
import { restoreSession } from "./restore-session";
import { signIn as signInFlow, type SignInOutcome } from "./sign-in";
import { signOut as signOutFlow } from "./sign-out";
import { authSessionStore } from "./token-store";

export interface AuthContextValue extends AuthState {
  /** Resolves once the attempt finishes; check the returned outcome (or
   * the updated `signInError` state) for the result — this never throws. */
  signIn(email: string, password: string): Promise<SignInOutcome>;
  signOut(): Promise<void>;
  /** Re-attempts app-start session restore after a network-error state. */
  retryRestore(): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(authReducer, initialAuthState);
  const queryClient = useQueryClient();
  // Guards against a slow restore attempt resolving after a newer one
  // (e.g. the user tapped "retry") has already started.
  const restoreAttemptId = useRef(0);

  const runRestore = useCallback(async () => {
    const attemptId = ++restoreAttemptId.current;
    const outcome = await restoreSession({
      getSession: () => authSessionStore.getSession(),
      clearSession: () => authSessionStore.clearSession(),
      getCurrentUser,
    });

    if (attemptId !== restoreAttemptId.current) return; // superseded

    switch (outcome.type) {
      case "authenticated":
        dispatch({
          type: "RESTORE_AUTHENTICATED",
          user: outcome.user,
          expiresAt: outcome.expiresAt,
        });
        break;
      case "unauthenticated":
        dispatch({ type: "RESTORE_UNAUTHENTICATED" });
        break;
      case "network-error":
        dispatch({ type: "RESTORE_NETWORK_ERROR" });
        break;
    }
  }, []);

  useEffect(() => {
    void runRestore();
    // Intentionally runs once on mount; `retryRestore` re-triggers it
    // explicitly rather than this effect re-running.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const retryRestore = useCallback(() => {
    dispatch({ type: "RESTORE_RETRY" });
    void runRestore();
  }, [runRestore]);

  const signIn = useCallback(async (email: string, password: string) => {
    dispatch({ type: "SIGN_IN_START" });
    const outcome = await signInFlow(
      {
        loginWithPassword,
        saveSession: (session) => authSessionStore.saveSession(session),
        invalidateToken,
      },
      email,
      password,
    );

    if (outcome.type === "success") {
      dispatch({
        type: "SIGN_IN_SUCCESS",
        user: outcome.user,
        expiresAt: outcome.expiresAt,
      });
    } else {
      dispatch({ type: "SIGN_IN_ERROR", message: outcome.message });
    }

    return outcome;
  }, []);

  const signOut = useCallback(async () => {
    dispatch({ type: "SIGN_OUT_START" });
    await signOutFlow({
      logout: logoutRequest,
      clearSession: () => authSessionStore.clearSession(),
      clearUserScopedQueries: () => {
        queryClient.clear();
      },
    });
    dispatch({ type: "SIGN_OUT_DONE" });
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, signIn, signOut, retryRestore }),
    [state, signIn, signOut, retryRestore],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider.");
  }
  return context;
}
