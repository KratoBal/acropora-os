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
}

export interface UpdateUserInput {
  firstName?: string;
  lastName?: string;
  /** Empty string clears it, absent leaves it alone. */
  nickname?: string | null;
  email?: string;
  role?: UserRole;
  expectedUpdatedAt: string;
}

export interface SetUserPasswordInput {
  password: string;
}
