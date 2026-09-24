import { useCallback, useEffect, useState } from "react";

import type { ThemePreference } from "./theme-preference";
import { themePreferenceStore } from "./theme-preference-store";

/**
 * A MENTETT VÁLASZTÁS, BETÖLTVE ÉS ÍRHATÓAN -- a `usePushPreference.ts`
 * mintájára. A `loading` külön áll a beállítatlan (`null`) állapottól:
 * amíg tölt, a képernyő ne mutasson egy pillanatra téves sémát.
 */
export function useThemePreference() {
  const [preference, setPreference] = useState<ThemePreference | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const stored = await themePreferenceStore.get();
      if (!alive) return;
      setPreference(stored);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const save = useCallback(async (value: ThemePreference) => {
    setPreference(value);
    await themePreferenceStore.set(value);
  }, []);

  return { preference, loading, save };
}
