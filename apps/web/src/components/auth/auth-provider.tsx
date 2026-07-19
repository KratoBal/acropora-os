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

interface AuthContextValue {
  session: Session | null;
  isLoading: boolean;
  login(email: string): Promise<void>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const adapter = useMemo(() => new DevelopmentAuthAdapter(), []);
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
      async login(email) {
        setSession(await adapter.login(email));
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
