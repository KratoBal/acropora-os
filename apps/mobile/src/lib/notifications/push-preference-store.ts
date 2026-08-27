import * as SecureStore from "expo-secure-store";

import type { PushPreference } from "./push-preference";

const KEY = "acropora.push-preference";

/**
 * A kapcsolo allasa a keszuleken. VEKONY adapter: a dontes a
 * `push-preference.ts` modulban all, mert az `node --test` alatt is fut, ez a
 * fajl viszont natív futasidot kivan.
 *
 * Miert SecureStore es nem AsyncStorage: nem titok, de a projekt ma egyetlen
 * helyi tarolot hasznal, es egy masodik fuggoseg egy logikai ertek kedveert
 * tobbet vinne, mint amennyit er.
 */
export const pushPreferenceStore = {
  async get(): Promise<PushPreference | null> {
    const raw = await SecureStore.getItemAsync(KEY);
    return raw === "on" || raw === "off" ? raw : null;
  },
  async set(value: PushPreference): Promise<void> {
    await SecureStore.setItemAsync(KEY, value);
  },
};
