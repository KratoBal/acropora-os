import * as SecureStore from "expo-secure-store";

import type { StoredSession } from "./types";

const SESSION_KEY = "acropora.auth-session";

/**
 * The only place the raw Bearer token is written to or read from disk —
 * exclusively `expo-secure-store` (iOS Keychain / Android Keystore). Never
 * AsyncStorage, never SQLite, never the React Query persist cache. Stores
 * the token together with its own server-issued `expiresAt` so an
 * unambiguously expired session can be discarded before ever calling
 * `/auth/me` (see restore-session.ts).
 *
 * This is the thin, native-runtime-only "adapter" half of the auth layer
 * — it cannot be unit tested outside a real Expo/React Native runtime
 * (SecureStore has no meaningful behavior under plain `node --test`). The
 * testable logic (restore-session.ts, sign-in.ts, sign-out.ts) depends
 * only on the `getSession`/`saveSession`/`clearSession` shape below, never
 * on `expo-secure-store` directly, so it can be exercised with a fake.
 */
export const authSessionStore = {
  async getSession(): Promise<StoredSession | null> {
    const raw = await SecureStore.getItemAsync(SESSION_KEY);
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw) as Partial<StoredSession>;
      if (typeof parsed.token !== "string" || typeof parsed.expiresAt !== "string") {
        return null;
      }
      return { token: parsed.token, expiresAt: parsed.expiresAt };
    } catch {
      // Corrupt/unexpected content — treat as "no session" rather than
      // throwing during app startup.
      return null;
    }
  },

  async saveSession(session: StoredSession): Promise<void> {
    await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  },

  async clearSession(): Promise<void> {
    await SecureStore.deleteItemAsync(SESSION_KEY);
  },

  /** Convenience for the API client, which only ever needs the bare token
   * string for the Authorization header, not the expiry. */
  async getToken(): Promise<string | null> {
    const session = await this.getSession();
    return session?.token ?? null;
  },
};
