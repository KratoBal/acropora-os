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

/**
 * A FIÓKHOZ MENTETT TÉMA, KÖZÖS TÁROLÓBAN (Balázs, 2026-11-09: a telefon böngészője minden alkalommal elfelejtette;
 * a localStorage-t egy Discordból nyitott link, egy privát lap vagy a Safari ITP elviszi).
 *
 * A SZERVER AZ ELSŐDLEGES: belépéskor a fiók témája (`applyServerThemePreference`) felülírja a helyit, és a helyi
 * tár ettől fogva csak gyorsítótár. Választáskor a tároló menti a helyit, és a bekötött mentéssel (`setThemePreference
 * Persistence`) a szerverre is.
 *
 * NINCS SÖTÉT VILLANÁS: az a kliens, amelyik a szervertől várja a témát (`holdThemeForServer`, az OS weben), helyi
 * érték nélkül a szerver válaszáig VILÁGOSAN marad, nem a telefon sötét módjára vált át előre. Ahol nincs szerver
 * (a partner portál ma), a régi viselkedés áll: a helyi érték, vagy a rendszer.
 *
 * EGY TÁROLÓ, MINDEN HOOK UGYANAZT LÁTJA: eddig minden `useThemePreference` a saját állapotát olvasta, tehát egy
 * választás csak a választó keretében hatott, a többi lap újranyitásig a régit mutatta.
 */
export interface ThemeState {
  preference: ThemePreference;
  /** false: a szerver még nem válaszolt, és nincs helyi érték; addig világos marad */
  settled: boolean;
}

let state: ThemeState | null = null;
let holdForServer = false;
let persist: ((preference: ThemePreference) => Promise<unknown>) | null = null;
/** The signed-in account the cached value belongs to (barracuda, #2310): set with the server's answer. */
let account: string | null = null;
const listeners = new Set<() => void>();

const notify = () => {
  for (const listener of listeners) listener();
};

/** The stored value, or null when there is none (not "system": the two mean different things to the hold). */
export function readCachedThemePreference(): ThemePreference | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isThemePreference(stored) ? stored : null;
  } catch {
    return null;
  }
}

/*
  WHOSE CACHED VALUE IT IS (barracuda, #2310): on a shared browser person A's choice must not stay with person B whose
  account has none. The owner is kept next to the value; a value without an owner (chosen while signed out, or from
  before the account kept it) is the browser's own.
*/
const OWNER_KEY = "acropora-theme-preference-owner";

function readCacheOwner(): string | null {
  try {
    return window.localStorage.getItem(OWNER_KEY);
  } catch {
    return null;
  }
}

function writeCache(
  preference: ThemePreference | null,
  owner: string | null,
): void {
  try {
    if (preference === null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, preference);
    if (owner === null) window.localStorage.removeItem(OWNER_KEY);
    else window.localStorage.setItem(OWNER_KEY, owner);
  } catch {
    // a browser without storage keeps the choice for this page only
  }
}

/** The OS web calls it once, before the first render: without a cached value it waits for the server, in light. */
export function holdThemeForServer(): void {
  holdForServer = true;
}

export function getThemeState(): ThemeState {
  if (state === null) {
    const cached =
      typeof window === "undefined" ? null : readCachedThemePreference();
    state = {
      preference: cached ?? "system",
      settled: cached !== null || !holdForServer,
    };
  }
  return state;
}

/** Before hydration and on the server: system, not settled (light). */
export const SERVER_THEME_STATE: ThemeState = {
  preference: "system",
  settled: false,
};

export function subscribeThemeState(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The account's theme after sign-in: the server's value wins and is cached under that account; `null` (not chosen, or
 * signed out) keeps what the browser has, unless the cached value is another account's: then the system decides.
 * Either way the wait is over.
 */
export function applyServerThemePreference(
  server: ThemePreference | null,
  accountId: string | null = null,
): void {
  const current = getThemeState();
  account = accountId;
  let preference = server ?? current.preference;
  if (server !== null) writeCache(server, accountId);
  else if (accountId !== null) {
    const owner = readCacheOwner();
    if (owner !== null && owner !== accountId) {
      writeCache(null, null);
      preference = "system";
    }
  }
  if (preference === current.preference && current.settled) return;
  state = { preference, settled: true };
  notify();
}

/** Where a choice is saved besides the browser (the OS web: the account); `null` when signed out. */
export function setThemePreferencePersistence(
  save: ((preference: ThemePreference) => Promise<unknown>) | null,
): void {
  persist = save;
}

/** A person's choice: at once here and in every view, then on the account when a save is bound. */
export function chooseThemePreference(preference: ThemePreference): void {
  writeCache(preference, account);
  state = { preference, settled: true };
  notify();
  // a failed save keeps the choice in this browser; the next sign-in shows the account's value again
  void persist?.(preference).catch((error: unknown) => {
    console.warn("A téma mentése a fiókhoz nem sikerült.", error);
  });
}

/** Tests only: back to the state before the first read. */
export function resetThemeStateForTests(): void {
  state = null;
  holdForServer = false;
  persist = null;
  account = null;
  listeners.clear();
}
