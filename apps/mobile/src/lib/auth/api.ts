import { apiRequest } from "@/lib/api/client";

import type { AuthenticatedUser, LoginResult } from "./types";

/**
 * Thin wrappers around the three auth endpoints this checkpoint needs,
 * matching the already-merged backend contract exactly (see
 * apps/api/src/auth/auth.controller.ts, docs/AUTHENTICATION.md):
 * - POST /auth/mobile/login/password -> { token, expiresAt, user }
 * - GET  /auth/me                    -> AuthenticatedUser
 * - POST /auth/logout                -> { success: true }
 *
 * No new, competing HTTP client — everything goes through the shared
 * `apiRequest` in apps/mobile/src/lib/api/client.ts.
 */

export async function loginWithPassword(
  email: string,
  password: string,
): Promise<LoginResult> {
  // `skipAuth: true` — this is the one request that must never carry a
  // previously stored (possibly stale or invalid) Bearer token.
  return apiRequest<LoginResult>("/auth/mobile/login/password", {
    method: "POST",
    body: JSON.stringify({ email, password }),
    skipAuth: true,
  });
}

export async function getCurrentUser(): Promise<AuthenticatedUser> {
  return apiRequest<AuthenticatedUser>("/auth/me");
}

export async function logout(): Promise<void> {
  await apiRequest<{ success: boolean }>("/auth/logout", { method: "POST" });
}

/**
 * Invalidates a specific, explicitly-provided token — used only when a
 * freshly issued session could not be saved to SecureStore, so it never
 * became the "current" stored token in the first place (see sign-in.ts).
 */
export async function invalidateToken(token: string): Promise<void> {
  await apiRequest<{ success: boolean }>("/auth/logout", {
    method: "POST",
    authToken: token,
  });
}
