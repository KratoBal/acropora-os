import * as SecureStore from "expo-secure-store";

const AUTH_TOKEN_KEY = "acropora.auth-token";

export const authTokenStore = {
  get(): Promise<string | null> {
    return SecureStore.getItemAsync(AUTH_TOKEN_KEY);
  },
  set(token: string): Promise<void> {
    return SecureStore.setItemAsync(AUTH_TOKEN_KEY, token, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  },
  clear(): Promise<void> {
    return SecureStore.deleteItemAsync(AUTH_TOKEN_KEY);
  },
};
