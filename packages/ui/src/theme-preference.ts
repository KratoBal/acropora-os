/**
 * VILÁGOS / SÖTÉT / RENDSZER SZERINT -- MEGŐRZÖTT, SZEMÉLYES PREFERENCIA.
 *
 * IDE KÖLTÖZÖTT 2026-09-25-én, A PARTNER PORTÁL FIGMA-KÖRÉVEL (acrobot
 * döntése): a `pilot-ui.tsx` a MÁSODIK fogyasztója lett ennek a modulnak
 * (`apps/web` mellett `apps/partner` is a pilot-aqua design-rendszerre áll
 * át), és a repó saját szabálya szerint ("ha egy komponenst második helyen
 * is használnál, oda kerül") ez a hely a `packages/ui`. Korábban
 * `apps/web/src/lib/theme/theme-preference.ts` állt, a tartalom betűre
 * változatlan.
 *
 * Balázs döntése (2026-09-24 15:59 UTC, emlék 1816): a Figma-terv válik a
 * web és a mobil ÚJ kinézetévé, fokozatosan. A választó a Beállításokba
 * kerül (nem a felső sávba), és a választás megmarad.
 *
 * EZ A MODUL CSAK A PREFERENCIÁT KEZELI, NEM AZT, HOGY MELYIK OLDAL
 * REAGÁL RÁ. Az `effectiveTheme` (a ténylegesen alkalmazandó "light"/"dark")
 * a preferenciából és a rendszer beállításából számolt, tiszta függvény --
 * a hívó (egy adott pilot oldal gyökere) dönti el, hogy egyáltalán RÁTESZI-e
 * a `data-theme` attribútumot a saját fájára. Ez szándékos: az ELSŐ körben
 * csak a Figma-szerű oldalak (Akváriumok, Mérési előzmények) kapnak
 * `data-theme`-et -- a többi oldal fájában ez az attribútum SOSEM jelenik
 * meg, tehát a `packages/ui/src/figma-theme.css` sötét-felülíró
 * szabályai (`[data-theme="dark"] .bg-white { ... }`) rájuk nézve
 * SZERKEZETILEG nem tudnak lefutni -- nem "valószínűleg nem törnek el",
 * hanem a CSS-szelektor egyszerűen nem talál olyan ősöt, ahol illeszkedne.
 */

export type ThemePreference = "light" | "dark" | "system";
export type EffectiveTheme = "light" | "dark";

const STORAGE_KEY = "acropora-theme-preference";

function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

export function readThemePreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isThemePreference(stored) ? stored : "system";
  } catch {
    // Privát böngészés vagy letiltott tárhely -- a rendszer-alapértelmezés
    // ilyenkor sem hibázik, csak nem marad meg a következő látogatásig.
    return "system";
  }
}

export function writeThemePreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // Lásd fent -- a preferencia ilyenkor csak a jelen munkamenetben él.
  }
}

export function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolveEffectiveTheme(
  preference: ThemePreference,
  systemIsDark: boolean,
): EffectiveTheme {
  if (preference === "system") return systemIsDark ? "dark" : "light";
  return preference;
}
