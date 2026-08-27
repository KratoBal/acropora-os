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

import { environment } from "@/config/env";

import {
  getCurrentUser,
  invalidateToken,
  loginWithPassword,
  logout as logoutRequest,
} from "./api";
import { subscribeToAppState } from "./app-state";
import { authReducer, initialAuthState, type AuthState } from "./auth-reducer";
import { unlockWithBiometrics } from "./biometric-unlock";
import { watchForegroundLock } from "./foreground-watcher";
import { forgetOfflineAssets } from "@/lib/offline/asset-cache";

import { restoreSession } from "./restore-session";
import { resumeSession } from "./resume-session";
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
  /** Asks the device to confirm the owner again from the locked state. */
  unlock(): Promise<void>;
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
      unlock: unlockWithBiometrics,
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
      case "locked":
        dispatch({ type: "SESSION_LOCKED", reason: outcome.reason });
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

  // Held in a ref so the foreground watcher can be mounted once and still
  // see who is signed in now. Re-subscribing on every state change would
  // restart the clock that measures how long the app was away.
  //
  // Written from an effect rather than during render: the watcher reads it
  // from a callback, long after the commit, so there is nothing to gain
  // from updating it earlier and a lint rule against doing so.
  const currentUser = useRef(state.user);
  useEffect(() => {
    currentUser.current = state.user;
  }, [state.user]);

  const unlock = useCallback(async () => {
    const user = currentUser.current;
    if (!user) {
      // Locked before anyone was restored - a cold start. There is no
      // session in memory to return to, so the full restore runs again,
      // server check included.
      retryRestore();
      return;
    }

    const outcome = await resumeSession(
      {
        getSession: () => authSessionStore.getSession(),
        clearSession: () => authSessionStore.clearSession(),
        unlock: unlockWithBiometrics,
      },
      user,
    );

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
      case "locked":
        dispatch({ type: "SESSION_LOCKED", reason: outcome.reason });
        break;
    }
  }, [retryRestore]);

  // One subscription for the life of the provider. The watcher itself
  // decides whether an absence was long enough to matter; see
  // lock-policy.ts for the threshold and foreground-watcher.ts for the
  // events it deliberately ignores.
  useEffect(
    () =>
      watchForegroundLock({
        subscribe: subscribeToAppState,
        now: Date.now,
        thresholdMs: environment.ok
          ? environment.config.foregroundLockThresholdMs
          : 0,
        onLock: () => {
          // Only worth locking something that is open. Nothing to shut on
          // the login screen, and re-locking an already locked app would
          // throw away the reason it locked for.
          if (currentUser.current) {
            // No reason: nobody has been asked yet. The locked screen
            // takes it from here.
            dispatch({ type: "SESSION_LOCKED" });
          }
        },
      }),
    [],
  );

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
      forgetOfflineData: forgetOfflineAssets,
    });
    dispatch({ type: "SIGN_OUT_DONE" });
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, signIn, signOut, retryRestore, unlock }),
    [state, signIn, signOut, retryRestore, unlock],
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
