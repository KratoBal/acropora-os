/**
 * VILÁGOS, SÖTÉT VAGY RENDSZER SZERINT -- A DÖNTÉS, A TÁROLÁSTÓL KÜLÖN.
 *
 * Ugyanaz a szétválasztás, mint a `push-preference.ts`-nél: a tárolás
 * natív (`expo-secure-store`), a döntés viszont `node --test` alatt is
 * mérhető, és ez a rész az, amit el lehet rontani.
 */

import type { ColorScheme } from "./tokens";

export type ThemePreference = "light" | "dark" | "system";

/**
 * A HATÁLYOS SZÍNSÉMA -- a mentett választás és a készülék állása alapján.
 *
 * A BEÁLLÍTATLAN VÁLASZTÁS ("system"-ként kezelve, `null` is ide esik) a
 * rendszer beállítását követi. HA A RENDSZER ÁLLÁSA IS ISMERETLEN (a React
 * Native `useColorScheme()` Androidon néhány esetben `null`-t ad), az
 * ALAPÉRTELMEZÉS SÖTÉT -- ez a mai, kizárólag sötét app-állapot, tehát egy
 * ismeretlen rendszer-állás nem hoz be egy soha nem látott, váratlan
 * világos képernyőt.
 */
export function resolveColorScheme(input: {
  preference: ThemePreference | null;
  system: ColorScheme | null;
}): ColorScheme {
  const effective = input.preference ?? "system";
  if (effective !== "system") return effective;
  return input.system ?? "dark";
}
