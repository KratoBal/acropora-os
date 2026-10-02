import type {
  AuthenticatedUser,
  CurrentUserResponse,
  Session,
} from "@acropora/types";

import { apiAuthHeaders } from "../api/client";
import type { AuthAdapter } from "./development-auth";
import { API_PREFIX } from "../api/api-prefix";

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
      response = await fetch(`${API_PREFIX}/auth/me`, {
        headers: { Accept: "application/json" },
      });
    } catch {
      return null;
    }
    if (!response.ok) return null;
    const {
      navigation,
      expiresAt: _expiresAt,
      ...user
    } = (await response.json()) as CurrentUserResponse;
    return toSession(user, navigation);
  }

  async login(email: string, password?: string): Promise<Session> {
    if (!password) {
      throw new Error("A jelszó megadása kötelező.");
    }

    let response: Response;
    try {
      response = await fetch(`${API_PREFIX}/auth/login/password`, {
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
    return toSession(user, await servedNavigation());
  }

  async logout(_session: Session): Promise<void> {
    await fetch(`${API_PREFIX}/auth/logout`, {
      method: "POST",
      headers: apiAuthHeaders("", "POST"),
    }).catch(() => undefined);
  }
}

/**
 * The menu for a fresh login: the login answer carries only the user, so the
 * menu comes from `/auth/me`, as on a reload. Best effort: without it every
 * server switch counts as off, and the next reload brings it.
 */
async function servedNavigation(): Promise<Session["navigation"]> {
  try {
    const response = await fetch(`${API_PREFIX}/auth/me`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return undefined;
    return ((await response.json()) as CurrentUserResponse).navigation;
  } catch {
    return undefined;
  }
}

function toSession(
  user: AuthenticatedUser,
  navigation?: Session["navigation"],
): Session {
  return {
    id: user.id,
    user,
    ...(navigation ? { navigation } : {}),
    // Real expiry is enforced server-side (the session cookie's Max-Age
    // and the API's own session TTL); nothing client-side reads this for
    // the production path.
    expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
    token: undefined,
  };
}
