/**
 * Manually kept, minimal mirror of the server contract in
 * `packages/types/src/auth.ts` (`AuthenticatedUser`/`UserRole`). The Expo
 * app deliberately does not import `@acropora/types` as a workspace
 * package — it has its own, app-local npm lockfile (see
 * docs/MOBILE-DEVELOPMENT.md), and pulling in a pnpm workspace package
 * from an npm-managed Expo project is not a safe/supported dependency
 * boundary here. If the server contract changes, this file needs a
 * matching manual update.
 */
export type UserRole =
  "OWNER" | "ADMIN" | "MANAGER" | "SALES" | "WAREHOUSE" | "SERVICE" | "VIEWER";

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  avatarUrl?: string | null;
}

/** Shape stored in SecureStore: the opaque Bearer token plus its own
 * server-issued expiry, so an unambiguously expired session can be
 * discarded locally before ever calling `/auth/me`. Never a JWT — the
 * token is opaque and is never decoded client-side. */
export interface StoredSession {
  token: string;
  expiresAt: string;
}

/** Response shape of `POST /auth/mobile/login/password`, per
 * apps/api/src/auth/auth.controller.ts `loginMobileWithPassword`. */
export interface LoginResult {
  token: string;
  expiresAt: string;
  user: AuthenticatedUser;
}
