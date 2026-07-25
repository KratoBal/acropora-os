"use client";

import type { Session } from "@acropora/types";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { DevelopmentAuthAdapter } from "@/lib/auth/development-auth";
import { ProductionAuthAdapter } from "@/lib/auth/production-auth";

interface AuthContextValue {
  session: Session | null;
  isLoading: boolean;
  login(email: string, password?: string): Promise<void>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

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
