"use client";

import type { Session } from "@acropora/types";
import {
  applyServerThemePreference,
  holdThemeForServer,
  setThemePreferencePersistence,
} from "@acropora/ui";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { authPreferencesApi } from "@/lib/api/auth-preferences";
import { DevelopmentAuthAdapter } from "@/lib/auth/development-auth";
import { ProductionAuthAdapter } from "@/lib/auth/production-auth";

interface AuthContextValue {
  session: Session | null;
  isLoading: boolean;
  login(email: string, password?: string): Promise<void>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/*
  THE THEME COMES FROM THE ACCOUNT (Balázs, 2026-11-09: the phone's browser forgot it every time). Before the first
  render: without a cached theme the views wait for the account's, in light, instead of following the phone's dark mode
  ahead of it.
*/
holdThemeForServer();

export function AuthProvider({ children }: { children: ReactNode }) {
  // Next.js sets NODE_ENV to "production" for a real `next build`/`next
  // start` and "development" under `next dev` — the same check the
  // adapters themselves already use (see DevelopmentAuthAdapter), so this
  // can't drift out of sync with what each adapter enforces server-side.
  const adapter = useMemo(
    () =>
      process.env.NODE_ENV === "production"
        ? new ProductionAuthAdapter()
        : new DevelopmentAuthAdapter(),
    [],
  );
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    void adapter.restoreSession().then((restoredSession) => {
      setSession(restoredSession);
      setIsLoading(false);
    });
  }, [adapter]);

  // the account's theme once the session is known (null: not chosen, or signed out), and where a choice is saved
  const themeAppliedFor = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (isLoading) return;
    // once per account (barracuda, #2310): a later session object of the same person must not carry an older value
    // back over a choice made since
    const accountId = session?.user.id ?? null;
    if (themeAppliedFor.current !== accountId) {
      themeAppliedFor.current = accountId;
      applyServerThemePreference(
        session?.user.themePreference ?? null,
        accountId,
      );
    }
    setThemePreferencePersistence(
      session
        ? (preference) =>
            // a cookie session has no readable token: the request carries the cookie (production-auth.ts)
            authPreferencesApi.setTheme(session.token ?? "", preference)
        : null,
    );
  }, [isLoading, session]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      isLoading,
      async login(email, password) {
        setSession(await adapter.login(email, password));
      },
      async logout() {
        if (session) await adapter.logout(session);
        setSession(null);
      },
    }),
    [adapter, isLoading, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context)
    throw new Error("A useAuth csak AuthProvideren belül használható.");
  return context;
}
