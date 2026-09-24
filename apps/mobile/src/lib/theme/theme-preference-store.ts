import * as SecureStore from "expo-secure-store";

import type { ThemePreference } from "./theme-preference";

const KEY = "acropora.theme-preference";

/**
 * A VÁLASZTÁS A KÉSZÜLÉKEN. VÉKONY ADAPTER, a `push-preference-store.ts`
 * mintájára -- a döntés a `theme-preference.ts`-ben áll, mert az
 * `node --test` alatt is fut, ez a fájl viszont natív futásidőt kíván.
 */
export const themePreferenceStore = {
  async get(): Promise<ThemePreference | null> {
    const raw = await SecureStore.getItemAsync(KEY);
    return raw === "light" || raw === "dark" || raw === "system" ? raw : null;
  },
  async set(value: ThemePreference): Promise<void> {
    await SecureStore.setItemAsync(KEY, value);
  },
};
