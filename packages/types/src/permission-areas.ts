import {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  type Permission,
  type UserRole,
} from "./auth.js";
import {
  ALL_PERMISSION_VALUES,
  type PermissionOverride,
} from "./permission-overrides.js";

/**
 * A JOGOK TERÜLETENKÉNT, A FELHASZNÁLÓ ADATLAPJÁNAK TÁBLÁZATÁHOZ (3. lépés,
 * acrobot 27194: területenként Nincs / Megtekintés / Kezelés).
 *
 * Egy terület egy sor: a `view` és a `manage` adja a három szintet (ha csak az
 * egyik létezik, csak kettő), a többi jog (`extras`) a sor alatt külön
 * kapcsolóként áll -- pl. a számlázás kiállítása vagy a szerviz rejtése. A
 * Számlázás saját sor (Balázs, 2026-10-06 20:23 UTC: nem követi a Pénzügyet).
 *
 * MINDEN JOGNAK PONTOSAN EGY HELYE VAN, és ezt teszt őrzi: egy új jog, ami
 * nem kerül ide, a táblázatból csendben hiányozna, és senki nem tudná egyénileg
 * megadni vagy elvenni.
 */
export interface PermissionArea {
  key: string;
  label: string;
  view?: Permission;
  manage?: Permission;
  extras: { permission: Permission; label: string }[];
}

const P = PERMISSIONS;

export const PERMISSION_AREAS: readonly PermissionArea[] = [
  { key: "dashboard", label: "Dashboard", view: P.DASHBOARD_VIEW, extras: [] },
  { key: "tasks", label: "Feladataim", view: P.TASKS_VIEW, extras: [] },
  {
    key: "messages",
    label: "Üzenetek",
    view: P.MESSAGES_USE,
    extras: [
      {
        permission: P.MESSAGES_ADMIN,
        label: "Mások beszélgetéseinek kezelése",
      },
    ],
  },
  {
    key: "orders",
    label: "Rendelések",
    view: P.ORDERS_VIEW,
    manage: P.ORDERS_MANAGE,
    extras: [],
  },
  {
    key: "products",
    label: "Termékek",
    view: P.PRODUCTS_VIEW,
    manage: P.PRODUCTS_MANAGE,
    extras: [
      {
        permission: P.PRODUCTS_CATALOG_AUTHORITY_TRANSFER,
        label: "Katalógus-gazda átvétele",
      },
      {
        permission: P.PRODUCTS_KNOWLEDGE_APPROVE,
        label: "Termék-tudás jóváhagyása",
      },
    ],
  },
  {
    key: "customers",
    label: "Vevők",
    view: P.CUSTOMERS_VIEW,
    manage: P.CUSTOMERS_MANAGE,
    extras: [],
  },
  {
    key: "inventory",
    label: "Készlet",
    view: P.INVENTORY_VIEW,
    manage: P.INVENTORY_MANAGE,
    extras: [
      {
        permission: P.INVENTORY_RECONCILIATION_REPAIR,
        label: "Készlet-egyeztetés javítása",
      },
    ],
  },
  {
    key: "purchasing",
    label: "Beszerzés",
    view: P.PURCHASING_VIEW,
    manage: P.PURCHASING_MANAGE,
    extras: [],
  },
  {
    key: "partners",
    label: "Partnerek",
    view: P.PARTNERS_VIEW,
    manage: P.PARTNERS_MANAGE,
    extras: [],
  },
  {
    key: "finance",
    label: "Pénzügy",
    view: P.FINANCE_VIEW,
    manage: P.FINANCE_MANAGE,
    extras: [],
  },
  {
    key: "billing",
    label: "Számlázás",
    view: P.BILLING_VIEW,
    manage: P.BILLING_CREATE,
    extras: [
      { permission: P.BILLING_ISSUE, label: "Bizonylat kiállítása" },
      { permission: P.BILLING_RESEND, label: "Bizonylat újraküldése" },
    ],
  },
  {
    key: "service",
    label: "Szerviz",
    view: P.SERVICE_VIEW,
    manage: P.SERVICE_MANAGE,
    extras: [
      {
        permission: P.SERVICE_WORKSHEET_AMEND,
        label: "Lezárt munkalap módosítása",
      },
      { permission: P.SERVICE_ASSET_DELETE, label: "Eszköz törlése" },
      { permission: P.SERVICE_HIDE, label: "Sorok rejtése" },
      {
        permission: P.SERVICE_VISIBILITY_ASSIGN,
        label: "Láthatósági hozzárendelés",
      },
    ],
  },
  {
    key: "mortality",
    label: "Elhullási napló",
    view: P.MORTALITY_VIEW,
    manage: P.MORTALITY_MANAGE,
    extras: [],
  },
  {
    key: "aquariums",
    label: "Akváriumok",
    view: P.AQUARIUMS_VIEW,
    manage: P.AQUARIUMS_MANAGE,
    extras: [],
  },
  {
    key: "icp",
    label: "ICP",
    view: P.ICP_VIEW,
    manage: P.ICP_MANAGE,
    extras: [],
  },
  {
    key: "content",
    label: "Tartalom",
    view: P.CONTENT_VIEW,
    manage: P.CONTENT_MANAGE,
    extras: [{ permission: P.CONTENT_APPROVE, label: "Tartalom jóváhagyása" }],
  },
  { key: "ai-test", label: "AI teszt", view: P.AI_TEST_VIEW, extras: [] },
  {
    key: "settings",
    label: "Beállítások",
    manage: P.SETTINGS_MANAGE,
    extras: [],
  },
  { key: "users", label: "Felhasználók", manage: P.USERS_MANAGE, extras: [] },
];

export type PermissionLevel = "none" | "view" | "manage";

/** A szintek, amelyek ezen a területen léteznek. */
export function areaLevels(area: PermissionArea): PermissionLevel[] {
  return [
    "none",
    ...(area.view ? (["view"] as const) : []),
    ...(area.manage ? (["manage"] as const) : []),
  ];
}

/**
 * A terület szintje egy jog-halmazban. A KEZELÉS a megtekintést is magában
 * foglalja (a szint-választó együtt állítja); ha valahol mégis csak a kezelés
 * állna, kezelésnek mutatjuk, mert az a tágabb.
 */
export function areaLevel(
  area: PermissionArea,
  permissions: ReadonlySet<Permission>,
): PermissionLevel {
  if (area.manage && permissions.has(area.manage)) return "manage";
  if (area.view && permissions.has(area.view)) return "view";
  return "none";
}

/** A jog-halmaz, ahol a terület szintje a megadott. */
export function withAreaLevel(
  area: PermissionArea,
  permissions: ReadonlySet<Permission>,
  level: PermissionLevel,
): Set<Permission> {
  const next = new Set(permissions);
  if (area.view) {
    if (level === "none") next.delete(area.view);
    else next.add(area.view);
  }
  if (area.manage) {
    if (level === "manage") next.add(area.manage);
    else next.delete(area.manage);
  }
  return next;
}

/**
 * AZ ELTÉRÉSEK, AMELYEK A SABLONBÓL A KÍVÁNT HALMAZT ADJÁK: amit a sablon nem
 * ad, de kell (megadás), és amit a sablon ad, de nem kell (elvétel).
 */
export function overridesForDesired(
  role: UserRole,
  desired: ReadonlySet<Permission>,
): PermissionOverride[] {
  const template = new Set<Permission>(ROLE_PERMISSIONS[role]);
  return ALL_PERMISSION_VALUES.flatMap((permission): PermissionOverride[] => {
    if (desired.has(permission) && !template.has(permission))
      return [{ permission, effect: "GRANT" }];
    if (!desired.has(permission) && template.has(permission))
      return [{ permission, effect: "REVOKE" }];
    return [];
  });
}
