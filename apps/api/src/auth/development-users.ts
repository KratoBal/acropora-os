import type { AuthenticatedUser } from "@acropora/types";

/**
 * Kizárólag helyi fejlesztéshez használható felhasználók.
 * Production auth provider nem támaszkodhat erre a listára.
 */
export const DEVELOPMENT_USERS: readonly AuthenticatedUser[] = [
  {
    id: "dev-owner",
    email: "owner@acropora.local",
    displayName: "Acropora Tulajdonos",
    role: "OWNER",
  },
  {
    id: "dev-admin",
    email: "admin@acropora.local",
    displayName: "Acropora Admin",
    role: "ADMIN",
  },
  {
    id: "dev-warehouse",
    email: "warehouse@acropora.local",
    displayName: "Raktári Felhasználó",
    role: "WAREHOUSE",
  },
  {
    id: "dev-service",
    email: "service@acropora.local",
    displayName: "Szerviz Felhasználó",
    role: "SERVICE",
  },
];
