import { useColorScheme } from "react-native";

import { resolveColorScheme, type ThemePreference } from "./theme-preference";
import { themeTokensFor, type ColorScheme, type ThemeTokens } from "./tokens";
import { useThemePreference } from "./useThemePreference";

export interface AppTheme {
  scheme: ColorScheme;
  tokens: ThemeTokens;
  /** `null`, amíg a mentett választás még nem töltött be. */
  preference: ThemePreference | null;
  loading: boolean;
  save(value: ThemePreference): Promise<void>;
}

/**
 * A HATÁLYOS TÉMA -- a mentett választás és a készülék rendszerbeállítása
 * együtt. Ez az EGYETLEN hely, ahonnan egy képernyő a színeit veszi; a
 * döntés maga a `theme-preference.ts`-ben áll, mérhetően.
 */
export function useAppTheme(): AppTheme {
  const rawSystem = useColorScheme();
  /*
    A `ColorSchemeName` HARMADIK ÉRTÉKE IS VAN ("unspecified", Android-on) --
    a `resolveColorScheme` csak "light"/"dark"/`null`-t ismer, tehát minden
    mást ismeretlenként kezelünk, ugyanúgy, ahogy a hiányzó (`undefined`)
    értéket is.
  */
  const system =
    rawSystem === "light" || rawSystem === "dark" ? rawSystem : null;
  const { preference, loading, save } = useThemePreference();
  const scheme = resolveColorScheme({ preference, system });

  return { scheme, tokens: themeTokensFor(scheme), preference, loading, save };
}
