import { ASSIGNABLE_ROLES, type UserRole } from "@acropora/types";

export const ROLE_LABELS: Record<UserRole, string> = {
  OWNER: "Tulajdonos",
  ADMIN: "Admin",
  MANAGER: "Menedzser",
  SALES: "Értékesítés",
  WAREHOUSE: "Raktár",
  SERVICE: "Szerviz",
  VIEWER: "Megtekintő",
  /**
   * GÉPI ÁGENS. Megjelenik a szerep-választóban, és ez szándékos: az ágens
   * felhasználói fiókját EMBER hozza létre, tehát valahol ki kell tudnia
   * választani. Egy rejtett szerep, amit csak adatbázisból lehet beállítani,
   * ugyanaz a kézi lépés lenne, amit ezzel az egésszel megszüntetünk.
   */
  CONTENT_AGENT: "Tartalom-ágens (gépi)",
  PARTNER_SERVICE: "Partner szerviz",
  ASSET_IMPORT_AGENT: "Eszköz-import ágens (gépi)",
  /** Sutyerák rendszer-fiókja: nem választható (`ASSIGNABLE_ROLES`), csak a címke kell. */
  ASSISTANT: "Sutyerák (rendszer)",
};

export const ROLE_OPTIONS = ASSIGNABLE_ROLES.map((role) => ({
  value: role,
  label: ROLE_LABELS[role],
}));
