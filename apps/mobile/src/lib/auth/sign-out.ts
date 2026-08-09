export interface SignOutDeps {
  logout(): Promise<void>;
  clearSession(): Promise<void>;
  /** Wired to `queryClient.clear()` in the real app — drops every
   * user-scoped query result from the React Query cache so nothing from
   * the signed-out user's session survives into the next login. */
  clearUserScopedQueries(): void;
}

/**
 * Logout, per the checkpoint spec:
 * 1. call `POST /auth/logout` so the server-side session is invalidated;
 * 2. clear the local token regardless of whether that call succeeded —
 *    including when the server already returns 401 (token already
 *    expired/invalid server-side) or the network call fails entirely.
 *    The accepted trade-off when the network call fails: the device
 *    stops authenticating locally immediately, but the server-side
 *    session row may briefly outlive that until it hits its own 8h TTL
 *    or a future explicit revocation — see docs/MOBILE-DEVELOPMENT.md;
 * 3. clear every user-scoped query from the cache so a subsequent login
 *    (as the same or a different user) never sees stale data.
 */
export async function signOut(deps: SignOutDeps): Promise<void> {
  try {
    await deps.logout();
  } catch {
    // Intentionally swallowed — see the trade-off note above. The local
    // token is cleared unconditionally in `finally` below.
  } finally {
    await deps.clearSession();
    deps.clearUserScopedQueries();
  }
}
