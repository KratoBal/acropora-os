"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { rc, ReefClubApiError } from "./api";

/** GET /rc/v1/me (apps/api/src/reefclub/reefclub-auth.service.ts, `ReefClubMe`). */
export interface Me {
  email: string;
  loginMethods: string[];
  notifyOnRelease: boolean;
  consentVersion: string;
}

export type SessionState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "user"; me: Me }
  | { status: "unavailable"; message: string };

interface SessionValue {
  state: SessionState;
  /** Reads the session again (after a sign-in, a settings change). */
  refresh(): Promise<void>;
  /** Ends the session on the server and goes to the sign-in page. */
  signOut(): Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<SessionState>({ status: "loading" });

  const refresh = useCallback(async () => {
    try {
      setState({ status: "user", me: await rc<Me>("GET", "/me") });
    } catch (error) {
      // 401 is the normal answer without a session; anything else is the service being away
      setState(
        error instanceof ReefClubApiError && error.status === 401
          ? { status: "anonymous" }
          : {
              status: "unavailable",
              message:
                error instanceof Error
                  ? error.message
                  : "A szolgáltatás most nem érhető el.",
            },
      );
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await rc("POST", "/auth/logout");
    } finally {
      setState({ status: "anonymous" });
      router.replace("/belepes");
    }
  }, [router]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({ state, refresh, signOut }),
    [state, refresh, signOut],
  );
  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession needs a SessionProvider");
  return value;
}

/** Shows its children to a signed-in user only; everyone else goes to the sign-in page. */
export function RequireSession({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { state } = useSession();

  useEffect(() => {
    if (state.status === "anonymous") router.replace("/belepes");
  }, [state.status, router]);

  if (state.status === "user") return <>{children}</>;
  if (state.status === "unavailable")
    return (
      <p role="alert" className="p-6 text-sm text-rose-700">
        {state.message}
      </p>
    );
  return (
    <p role="status" className="p-6 text-sm text-pilot-grey-500">
      Betöltés…
    </p>
  );
}
