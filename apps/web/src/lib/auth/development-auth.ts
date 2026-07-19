import type { AuthenticatedUser, Session } from "@acropora/types";

const SESSION_STORAGE_KEY = "acropora.development-session";
export const DEVELOPMENT_USERS: readonly AuthenticatedUser[] = [
  {
    id: "dev-owner",
    email: "owner@acropora.local",
    displayName: "Acropora Tulajdonos",
    role: "OWNER",
  },
  {
    id: "dev-admin",
    email: "admin@acropora.local",
    displayName: "Acropora Admin",
    role: "ADMIN",
  },
  {
    id: "dev-warehouse",
    email: "warehouse@acropora.local",
    displayName: "Raktári Felhasználó",
    role: "WAREHOUSE",
  },
  {
    id: "dev-service",
    email: "service@acropora.local",
    displayName: "Szerviz Felhasználó",
    role: "SERVICE",
  },
];

export interface AuthAdapter {
  restoreSession(): Promise<Session | null>;
  login(email: string): Promise<Session>;
  logout(session: Session): Promise<void>;
}

export class DevelopmentAuthAdapter implements AuthAdapter {
  async restoreSession(): Promise<Session | null> {
    if (process.env.NODE_ENV === "production") return null;

    const stored = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!stored) return null;

    try {
      const session = JSON.parse(stored) as Session;
      if (new Date(session.expiresAt).getTime() <= Date.now()) {
        window.localStorage.removeItem(SESSION_STORAGE_KEY);
        return null;
      }
      const response = await fetch("/api/auth/me", {
        headers: { Authorization: `Bearer ${session.token ?? ""}` },
      });
      if (!response.ok) {
        window.localStorage.removeItem(SESSION_STORAGE_KEY);
        return null;
      }
      return session;
    } catch {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
  }

  async login(email: string): Promise<Session> {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "A development login production környezetben le van tiltva.",
      );
    }

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (!response.ok) throw new Error("A development login sikertelen.");
    const session = (await response.json()) as Session;

    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    return session;
  }

  async logout(_session: Session): Promise<void> {
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: { Authorization: `Bearer ${_session.token ?? ""}` },
    }).catch(() => undefined);
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
  }
}
