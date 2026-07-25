import type { AuthenticatedUser, Session } from "@acropora/types";

import type { AuthAdapter } from "./development-auth";

/**
 * Production counterpart to DevelopmentAuthAdapter. The session itself
 * lives entirely server-side: `POST /api/auth/login/password` and
 * `GET /api/auth/me` both authenticate via an httpOnly cookie the browser
 * sends automatically (see docs/AUTHENTICATION.md) — there is no raw
 * token for client-side JS to read or store, unlike the development
 * adapter's `dev_`-prefixed bearer token in localStorage (a pattern the
 * same doc explicitly forbids in production).
 *
 * The `Session` shape returned here still satisfies the shared
 * `AuthAdapter`/`Session` contract so AuthProvider, AuthGate and every
 * page that reads `session.user` need no changes — only `token` and
 * `expiresAt` are placeholders, since neither is used or meaningful on
 * this path (apiRequest() already treats a missing token as "rely on the
 * cookie instead", see lib/api/client.ts).
 */
export class ProductionAuthAdapter implements AuthAdapter {
  async restoreSession(): Promise<Session | null> {
    let response: Response;
    try {
      response = await fetch("/api/auth/me", {
        headers: { Accept: "application/json" },
      });
    } catch {
      return null;
    }
    if (!response.ok) return null;
    const user = (await response.json()) as AuthenticatedUser;
    return toSession(user);
  }

  async login(email: string, password?: string): Promise<Session> {
    if (!password) {
      throw new Error("A jelszó megadása kötelező.");
    }

    let response: Response;
    try {
      response = await fetch("/api/auth/login/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
    } catch {
      throw new Error("A szerver nem érhető el. Ellenőrizd a kapcsolatot.");
    }

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error("Hibás e-mail cím vagy jelszó.");
      }
      throw new Error("A bejelentkezés sikertelen.");
    }

    const { user } = (await response.json()) as { user: AuthenticatedUser };
    return toSession(user);
  }

  async logout(_session: Session): Promise<void> {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
  }
}

function toSession(user: AuthenticatedUser): Session {
  return {
    id: user.id,
    user,
    // Real expiry is enforced server-side (the session cookie's Max-Age
    // and the API's own session TTL); nothing client-side reads this for
    // the production path.
    expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
    token: undefined,
  };
}
