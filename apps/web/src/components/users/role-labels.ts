import { USER_ROLES, type UserRole } from "@acropora/types";

export const ROLE_LABELS: Record<UserRole, string> = {
  OWNER: "Tulajdonos",
  ADMIN: "Admin",
  MANAGER: "Menedzser",
  SALES: "Értékesítés",
  WAREHOUSE: "Raktár",
  SERVICE: "Szerviz",
  VIEWER: "Megtekintő",
};

export const ROLE_OPTIONS = USER_ROLES.map((role) => ({
  value: role,
  label: ROLE_LABELS[role],
}));
