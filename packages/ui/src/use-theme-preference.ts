"use client";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import {
  chooseThemePreference,
  getThemeState,
  resolveEffectiveTheme,
  SERVER_THEME_STATE,
  subscribeThemeState,
  systemPrefersDark,
  type EffectiveTheme,
  type ThemePreference,
} from "./theme-preference";

export function useThemePreference(): {
  preference: ThemePreference;
  effectiveTheme: EffectiveTheme;
  setPreference: (next: ThemePreference) => void;
} {
  // one store for every view (theme-preference.ts): a choice or the account's value reaches them all at once
  const themeState = useSyncExternalStore(
    subscribeThemeState,
    getThemeState,
    () => SERVER_THEME_STATE,
  );
  const [systemIsDark, setSystemIsDark] = useState(false);

  useEffect(() => {
    setSystemIsDark(systemPrefersDark());

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) =>
      setSystemIsDark(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    chooseThemePreference(next);
  }, []);

  return {
    preference: themeState.preference,
    // while the account's theme is awaited without a cached one, light: no dark flash for a light account
    effectiveTheme: themeState.settled
      ? resolveEffectiveTheme(themeState.preference, systemIsDark)
      : "light",
    setPreference,
  };
}
