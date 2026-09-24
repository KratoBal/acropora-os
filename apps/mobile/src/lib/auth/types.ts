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
  | "OWNER"
  | "ADMIN"
  | "MANAGER"
  | "SALES"
  | "WAREHOUSE"
  | "SERVICE"
  | "VIEWER"
  | "PARTNER_SERVICE";

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
  /**
   * MELYIK VEVO, ILLETVE MELYIK SZALLITO NEVEBEN LEP BE EZ A FIOK -- a kettobol
   * legfeljebb az egyik all, es belso kolleganal MIND A KETTO `null`.
   *
   * MIERT KERULT BE (2026-09-22): a telefon a munkalap-gombot a HATOKORHOZ
   * akarja kotni, nem a szerephez. A szerver ugyanezt a ket mezot hasznalja
   * (`partnerScopeOf`), es a `/auth/me` valasza MAR MA IS hordozza oket --
   * csak ez a tukor nem deklaralta. Ugyanaz a fajta, amit a fajl fejlece
   * kimond: a szerzodes valtozasat kezzel kell atvezetni.
   *
   * ELHAGYHATO, ES EZ SZANDEKOS. Egy KOTELEZO mezo azt allitana, hogy MINDIG
   * megerkezik -- pont az a hazugsag, ami 2026-09-22 este az osszeomlast
   * okozta a hibajegy-lapon. Egy regebbi szerver nem kuldi, es akkor a mezo
   * `undefined`, nem `null`. A KET ALLAPOT MAST JELENT:
   *
   *     null        a szerver AZT MONDTA, hogy nincs hatokor (belso kollega)
   *     undefined   a mezo MEG NEM ERKEZETT MEG (regi szerver vagy elveszett)
   *
   * A kettot a `hatokorAValaszbol` kulonbozteti meg, es ott all a dontes is,
   * mit csinalunk a masodik esetben.
   *
   * MERVE AZ ELES ADATBAZISON (acrobot, 2026-09-22 21:15): nyolc felhasznalo,
   * a ket `PARTNER_SERVICE` fioknak VAN `customerId` erteke, a hat belsonek
   * mind a ketto `null`. A `supplierId` MA minden soron `null` -- de ez
   * ALLAPOT, nem szerkezet: az oszlop letezik es a szerver szamol vele, csak
   * ma senki nem all rajta. Ezert olvassuk MIND A KETTOT.
   */
  customerId?: string | null;
  supplierId?: string | null;
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
  /**
   * A BEJELENTKEZETT FELHASZNALO, A KESZULEKEN.
   *
   * Az offline indulashoz kell: ha nincs halozat, a `/auth/me` nem valaszol, es
   * a kapunak nincs mit visszaadnia. Enelkul a 24 oras beengedes nem
   * megvalosithato -- csak eldontheto.
   *
   * ES AZERT ITT VAN, UGYANABBAN A REKORDBAN, MINT A TOKEN: a kijelentkezes egy
   * SecureStore kulcsot torol, tehat a profil vele megy, es ezt nem lehet
   * elfelejteni. Egy KULON rekord kulon torlest igenyelne, es egy elmaradt
   * torles utan a kovetkezo ember a telefonon az elozo kollega nevet es jogkoret
   * latna -- nem hibauzenettel, hanem ugy, mintha be lenne jelentkezve.
   *
   * Regi telepitesen hianyzik (a mezo most szuletik), ezert opcionalis.
   */
  user?: AuthenticatedUser;
  /**
   * Az utolso SIKERES szerver-ellenorzes ideje, ISO alakban. A 24 oras offline
   * kapu ezt meri (`lib/auth/offline-grace.ts`). Regi telepitesen hianyzik, es
   * a hianya NEM beengedes -- lasd az ottani `never-verified` agat.
   */
  lastVerifiedAt?: string;
}

/** Response shape of `POST /auth/mobile/login/password`, per
 * apps/api/src/auth/auth.controller.ts `loginMobileWithPassword`. */
export interface LoginResult {
  token: string;
  expiresAt: string;
  user: AuthenticatedUser;
}

/**
 * Response shape of `GET /auth/me`, per
 * apps/api/src/auth/auth.controller.ts `getCurrentUser` /
 * `@acropora/types` `CurrentUserResponse`. `expiresAt` NOT folded into
 * `AuthenticatedUser` on purpose (unlike `navigation`, which really is a
 * per-user display fact): it describes the SESSION's current lifetime,
 * not the user, and every other place `AuthenticatedUser` is used
 * (auth-reducer, offline session state, ...) expects a clean user object.
 *
 * `expiresAt` UJONNAN, Balazs kerese (2026-09-24 08:37, mobil szal): a
 * csuszo munkamenet-hosszabbitas (lasd `apps/api/.../session.repository.ts`)
 * csak ITT jut vissza a mobil kliensre -- `restoreSession` ezzel irja
 * felul a helyben tarolt `expiresAt`-et. OPCIONALIS, mert egy regebbi
 * API-telepites nem kuldi; a hianya NEM azt jelenti, hogy a session
 * lejart, csak azt, hogy a hivo tartsa meg a meglevo helyi erteket.
 */
export interface CurrentUserResponse extends AuthenticatedUser {
  expiresAt?: string;
}
