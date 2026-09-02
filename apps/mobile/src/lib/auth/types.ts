/**
 * Manually kept, minimal mirror of the server contract in
 * `packages/types/src/auth.ts` (`AuthenticatedUser`/`UserRole`). The Expo
 * app deliberately does not import `@acropora/types` as a workspace
 * package — it has its own, app-local npm lockfile (see
 * docs/MOBILE-DEVELOPMENT.md), and pulling in a pnpm workspace package
 * from an npm-managed Expo project is not a safe/supported dependency
 * boundary here. If the server contract changes, this file needs a
 * matching manual update.
 */
export type UserRole =
  "OWNER" | "ADMIN" | "MANAGER" | "SALES" | "WAREHOUSE" | "SERVICE" | "VIEWER";

/**
 * Egy menutetel ugy, ahogy a szerver kiadja (`@acropora/types`
 * NavigationEntryView). KEZZEL KARBANTARTOTT TUKOR, mint az egesz fajl: a
 * mobil csomag SZANDEKOSAN nem fugg a munkater csomagjaitol (sajat npm
 * lockfile, es a pnpm-workspace kizarja), tehat importalni nem lehet.
 *
 * A FELULET IS ATJON, nem csak az azonosito. Enelkul ez az app nem tudna
 * megkulonboztetni a "nem ismerem ezt a tetelt" esetet (regebbi telepites,
 * ujabb szerver) attol, hogy "ez a tetel a webre valo". Mindketto kihagyas, de
 * az elso verzio-csuszas, a masodik normal mukodes.
 */
export interface NavigationEntryView {
  id: string;
  surfaces: ("web" | "mobile")[];
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  /** What the team calls them; see person-name.ts. Absent on older
   * servers, which is why the display helper falls back. */
  nickname?: string | null;
  role: UserRole;
  avatarUrl?: string | null;
  /**
   * A menu, amit ez a felhasznalo lathat -- MAR SZURVE a szerveren.
   *
   * OPCIONALIS, es ez nem lustasag: egy regebbi szerver nem kuldi. Ha kotelezo
   * lenne, egy ilyen szerver ellen az app egyetlen csempet sem rajzolna ki, es
   * a felhasznalo egy ures kezdokepernyot latna hibauzenet nelkul. A hianyra a
   * kezdokepernyo a sajat kepesseg-tablaira esik vissza -- atmenetileg, amig a
   * (4) lepes azokat ki nem veszi.
   */
  navigation?: NavigationEntryView[];
}

/** Shape stored in SecureStore: the opaque Bearer token plus its own
 * server-issued expiry, so an unambiguously expired session can be
 * discarded locally before ever calling `/auth/me`. Never a JWT — the
 * token is opaque and is never decoded client-side. */
export interface StoredSession {
  token: string;
  expiresAt: string;
}

/** Response shape of `POST /auth/mobile/login/password`, per
 * apps/api/src/auth/auth.controller.ts `loginMobileWithPassword`. */
export interface LoginResult {
  token: string;
  expiresAt: string;
  user: AuthenticatedUser;
}
