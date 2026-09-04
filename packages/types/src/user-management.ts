import type { UserRole } from "./auth.js";

export interface UserSummary {
  id: string;
  firstName: string;
  lastName: string;
  /** The official, full name. Documents use this one. */
  displayName: string;
  /** What the team calls them. Interfaces show this instead of
   * `displayName` when it is set; see `personDisplayName`. */
  nickname?: string | null;
  email: string;
  role: UserRole;
  isActive: boolean;
  hasPassword: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserDetail extends UserSummary {
  avatarUrl?: string;
  passwordUpdatedAt?: string;
  /**
   * MELYIK PARTNERHEZ TARTOZIK, VAGY `null`, HA SAJAT KOLLEGA.
   *
   * KOTELEZO MEZO, ES A HIANYT `null` JELOLI, NEM A MEZO ELHAGYASA. Egy
   * elhagyhato mezo nem all ott a valaszban es nem all ott egy teszt-duplaban
   * sem, tehat a hivo nem latja, hogy letezik. A `null` mindket helyen ott van.
   *
   * MIERT KELL A VALASZBAN. A lathatosagi hozzarendeles (a `service-jobs`
   * `visibility/:userId` utja) harom okbol utasithat vissza, es kettot MA CSAK A
   * SZERVER lat: sajat kollega (nincs mit szukiteni) es tukor-vevo sor nelkuli
   * partner. Enelkul a felulet olyan alegyseget kinalna fel, amit a vegpont
   * utana visszautasit -- vagyis lathatoan a sajat szabalyunkkal menne szembe.
   *
   * CSAK A RESZLETLAPON ALL, A LISTAN NEM: ma egyedul a felhasznalo szerkeszto
   * lapnak kell, es a lista bovitese olyan mezot vinne minden sorba, amit senki
   * nem olvas. Ha kesobb a listanak is kell, az HANGOSAN derul ki (valaki
   * keri), nem csendben.
   */
  supplierId: string | null;
  /**
   * MELYIK VEVOHOZ TARTOZIK, VAGY `null`, HA NEM VEVO-OLDALI FELHASZNALO.
   *
   * A PARJA A `supplierId`-NEK, es 2026-09-04-ig HIANYZOTT INNEN. A sema
   * (`User.customerId`) mindig is ismerte, a hatokor-szamitas
   * (`partnerScopeOf`) MINDIG IS OLVASTA -- csak a kiadott alakbol maradt ki.
   * Vagyis a szerver tudta, melyik vevohoz tartozik a fiok, es a felulet nem.
   *
   * A KETTO KOZUL LEGFELJEBB AZ EGYIK LEHET KITOLTVE. Ez nem konvencio, hanem
   * adatbazis-szintu megszoritas (`User_at_most_one_partner_check`), es a
   * `partnerScopeOf` DOB, ha megis mind a ketto all -- egy ilyen sor tulajdonosa
   * minden keresre hibat kapna.
   */
  customerId: string | null;
}

export type UserStatusFilter = "ACTIVE" | "INACTIVE" | "ALL";

export interface UserListResponse {
  items: UserSummary[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

export interface CreateUserInput {
  firstName: string;
  lastName: string;
  email: string;
  role: UserRole;
  password?: string;
  /**
   * MELYIK VEVO NEVEBEN LEP BE EZ A FIOK. Elhagyhato: a sajat kollega egyik
   * partnerhez sem tartozik, es az a tobbseg.
   *
   * EZ NEM ADATMEZO, HANEM HATOKORT ADO VEZERLO. A `partnerScopeOf` ebbol
   * szamolja, mit lat az illeto: aki kap egy `customerId` erteket, az megkapja
   * annak a vevonek a hatokoret, es CSAK azt. Ezert all ugyanaz mogotte, mint
   * a szerepkor mogott: a `users.manage` jog, es az auditnaplo.
   */
  customerId?: string | null;
}

export interface UpdateUserInput {
  firstName?: string;
  lastName?: string;
  /** Empty string clears it, absent leaves it alone. */
  nickname?: string | null;
  email?: string;
  role?: UserRole;
  /**
   * MELYIK VEVOHOZ KOTJUK, VAGY `null`, HA ELVAGJUK A KOTEST.
   *
   * A HIANYZO ERTEK (`undefined`) VALTOZATLANUL HAGYJA, a `null` TOROLI, es a
   * ketto kozotti kulonbseg itt nagyobb, mint a becenevnel: a TORLES ugyanis
   * TAGITJA a hatokort. Egy vevohoz kotott fiok csak annak a vevonek a sorait
   * latja; ha a kotes eltunik, a fiok BELSOSSE valik, es MINDENT lat.
   *
   * Ezert a torles legalabb annyira erzekeny muvelet, mint a beallitas, es
   * ugyanaz a jog meg auditnaplo all mogotte.
   */
  customerId?: string | null;
  expectedUpdatedAt: string;
}

export interface SetUserPasswordInput {
  password: string;
}
