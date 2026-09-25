"use client";
import { useCallback, useEffect, useState } from "react";

import {
  readThemePreference,
  resolveEffectiveTheme,
  systemPrefersDark,
  writeThemePreference,
  type EffectiveTheme,
  type ThemePreference,
} from "./theme-preference";

/**
 * A PREFERENCIA ÉS A TÉNYLEGES SÖTÉT/VILÁGOS ÁLLAPOT, EGY HELYEN.
 *
 * IDE KÖLTÖZÖTT 2026-09-25-én, `theme-preference.ts`-szel együtt -- lásd
 * annak fejlécét az indokért (a `pilot-ui.tsx` MÁSODIK fogyasztója lett,
 * ezúttal `apps/partner`-ben).
 *
 * A Beállítások lap ezt hívja a választóhoz, egy pilot oldal gyökere ezt
 * hívja, hogy tudja, tegyen-e `data-theme`-et a saját fájára (lásd
 * `theme-preference.ts` fejlécét: a HATÁS oldala, hogy KI teszi rá az
 * attribútumot, nem ennek a hooknak a dolga).
 *
 * SSR-BIZTOS: a kezdeti állapot mindig "system"/"light" -- a valódi,
 * localStorage-ból/rendszerből olvasott érték csak `useEffect`-ben, a
 * kliens-oldali felcsatlakozás után kerül be. Enélkül a szerver-renderelt
 * és a kliens-hidratált JSX eltérne (a szerver nem ismeri sem a
 * localStorage-ot, sem a `prefers-color-scheme`-et), és React hidratációs
 * hibát jelezne.
 */
export function useThemePreference(): {
  preference: ThemePreference;
  effectiveTheme: EffectiveTheme;
  setPreference: (next: ThemePreference) => void;
} {
  const [preference, setPreferenceState] = useState<ThemePreference>("system");
  const [systemIsDark, setSystemIsDark] = useState(false);

  useEffect(() => {
    setPreferenceState(readThemePreference());
    setSystemIsDark(systemPrefersDark());

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) =>
      setSystemIsDark(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    writeThemePreference(next);
    setPreferenceState(next);
  }, []);

  return {
    preference,
    effectiveTheme: resolveEffectiveTheme(preference, systemIsDark),
    setPreference,
  };
}
