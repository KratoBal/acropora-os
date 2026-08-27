import type { AuthenticatedUser } from "@acropora/types";

/**
 * Kizárólag helyi fejlesztéshez használható felhasználók.
 * Production auth provider nem támaszkodhat erre a listára.
 */
/**
 * Mind a négy fejlesztői azonosság a MI kollégánk, tehát egyik sem tartozik
 * partnerhez. A két `null` ki van írva, és nem elhagyva: a mező kötelező, épp
 * azért, hogy ez a döntés minden felhasználót építő helyen látszódjon. Ha egy
 * nap kell egy partner-oldali fejlesztői azonosság, az EGY ÚJ sor lesz itt,
 * kitöltött mezővel, nem egy elfelejtett `undefined` valahol máshol.
 */
export const DEVELOPMENT_USERS: readonly AuthenticatedUser[] = [
  {
    id: "dev-owner",
    email: "owner@acropora.local",
    displayName: "Acropora Tulajdonos",
    role: "OWNER",
    customerId: null,
    supplierId: null,
  },
  {
    id: "dev-admin",
    email: "admin@acropora.local",
    displayName: "Acropora Admin",
    role: "ADMIN",
    customerId: null,
    supplierId: null,
  },
  {
    id: "dev-warehouse",
    email: "warehouse@acropora.local",
    displayName: "Raktári Felhasználó",
    role: "WAREHOUSE",
    customerId: null,
    supplierId: null,
  },
  {
    id: "dev-service",
    email: "service@acropora.local",
    displayName: "Szerviz Felhasználó",
    role: "SERVICE",
    customerId: null,
    supplierId: null,
  },
];
