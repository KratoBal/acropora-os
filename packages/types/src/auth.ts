export const USER_ROLES = [
  "OWNER",
  "ADMIN",
  "MANAGER",
  "SALES",
  "WAREHOUSE",
  "SERVICE",
  "VIEWER",
] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const PERMISSIONS = {
  DASHBOARD_VIEW: "dashboard.view",
  TASKS_VIEW: "tasks.view",
  ORDERS_VIEW: "orders.view",
  ORDERS_MANAGE: "orders.manage",
  PRODUCTS_VIEW: "products.view",
  PRODUCTS_MANAGE: "products.manage",
  CUSTOMERS_VIEW: "customers.view",
  CUSTOMERS_MANAGE: "customers.manage",
  INVENTORY_VIEW: "inventory.view",
  INVENTORY_MANAGE: "inventory.manage",
  PURCHASING_VIEW: "purchasing.view",
  PURCHASING_MANAGE: "purchasing.manage",
  /// A Partnerek menüpont: beszállítók és szerviz partnerek. Szándékosan
  /// KÜLÖN a beszerzési jogtól, mert a partner már nem csak beszerzési
  /// fogalom: szerviz partnernek munkalap és ajánlat is készül, a beszerzés
  /// pedig egy szervizesnek nem tartozik rá. Amíg a kettő egy jog volt, a
  /// SERVICE szerepkör a partnereket sem tudta listázni.
  PARTNERS_VIEW: "partners.view",
  /// A látás és az írás azért két jog, mert a bővítés iránya ismert: a
  /// szervizesek "egyelőre csak lássák" (Balázs döntése, 2026-08-21). Egy
  /// későbbi engedés így szerepkör-kiosztás lesz, nem újabb jog bevezetése.
  PARTNERS_MANAGE: "partners.manage",
  FINANCE_VIEW: "finance.view",
  FINANCE_MANAGE: "finance.manage",
  SERVICE_VIEW: "service.view",
  SERVICE_MANAGE: "service.manage",
  AQUARIUMS_VIEW: "aquariums.view",
  AQUARIUMS_MANAGE: "aquariums.manage",
  ICP_VIEW: "icp.view",
  ICP_MANAGE: "icp.manage",
  SETTINGS_MANAGE: "settings.manage",
  USERS_MANAGE: "users.manage",
  /// Egyedi rekordokra korlátozott, auditált készlet-repair (checkpoint 6
  /// - lásd apps/api/src/inventory/stock-reconciliation-repair.*).
  /// Szándékosan KÜLÖN a sima INVENTORY_MANAGE-től, amit a WAREHOUSE
  /// szerepkör is megkap a mindennapi leltár/beszerzés/POS munkához - egy
  /// repair közvetlenül felülírja a készlet "igazságát", ezért ugyanolyan
  /// szűk körnek jár, mint a SETTINGS_MANAGE/USERS_MANAGE (lásd
  /// ROLE_PERMISSIONS lent: csak OWNER/ADMIN, még a MANAGER sem).
  INVENTORY_RECONCILIATION_REPAIR: "inventory.reconciliation.repair",
  /// Lezárt munkalap módosítása (új verzió készítése). Szándékosan KÜLÖN a
  /// SERVICE_MANAGE-től: munkalapot írni és egy már kiadott, esetleg aláírt
  /// munkalapot átírni nem ugyanaz a jogkör - az utóbbi számlát alapozó
  /// dokumentumot érint. Ezért a SERVICE szerepkör NEM kapja meg (lásd
  /// ROLE_PERMISSIONS lent).
  SERVICE_WORKSHEET_AMEND: "service.worksheet.amend",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

const ALL_PERMISSIONS = Object.freeze(Object.values(PERMISSIONS));

const VIEW_PERMISSIONS: readonly Permission[] = [
  PERMISSIONS.DASHBOARD_VIEW,
  PERMISSIONS.TASKS_VIEW,
  PERMISSIONS.ORDERS_VIEW,
  PERMISSIONS.PRODUCTS_VIEW,
  PERMISSIONS.CUSTOMERS_VIEW,
  PERMISSIONS.INVENTORY_VIEW,
  PERMISSIONS.PURCHASING_VIEW,
  PERMISSIONS.PARTNERS_VIEW,
  PERMISSIONS.FINANCE_VIEW,
  PERMISSIONS.SERVICE_VIEW,
  PERMISSIONS.AQUARIUMS_VIEW,
  PERMISSIONS.ICP_VIEW,
];

export const ROLE_PERMISSIONS: Readonly<
  Record<UserRole, readonly Permission[]>
> = {
  OWNER: ALL_PERMISSIONS,
  ADMIN: ALL_PERMISSIONS,
  MANAGER: ALL_PERMISSIONS.filter(
    (permission) =>
      permission !== PERMISSIONS.SETTINGS_MANAGE &&
      permission !== PERMISSIONS.USERS_MANAGE &&
      permission !== PERMISSIONS.INVENTORY_RECONCILIATION_REPAIR &&
      permission !== PERMISSIONS.SERVICE_WORKSHEET_AMEND,
  ),
  SALES: [
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.TASKS_VIEW,
    PERMISSIONS.ORDERS_VIEW,
    PERMISSIONS.ORDERS_MANAGE,
    PERMISSIONS.PRODUCTS_VIEW,
    PERMISSIONS.CUSTOMERS_VIEW,
    PERMISSIONS.CUSTOMERS_MANAGE,
    PERMISSIONS.INVENTORY_VIEW,
    PERMISSIONS.FINANCE_VIEW,
  ],
  WAREHOUSE: [
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.TASKS_VIEW,
    PERMISSIONS.ORDERS_VIEW,
    PERMISSIONS.PRODUCTS_VIEW,
    PERMISSIONS.INVENTORY_VIEW,
    PERMISSIONS.INVENTORY_MANAGE,
    PERMISSIONS.PURCHASING_VIEW,
    PERMISSIONS.PURCHASING_MANAGE,
    PERMISSIONS.PARTNERS_VIEW,
    PERMISSIONS.PARTNERS_MANAGE,
  ],
  SERVICE: [
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.TASKS_VIEW,
    PERMISSIONS.PRODUCTS_VIEW,
    PERMISSIONS.CUSTOMERS_VIEW,
    /// Csak nézni. A szerviz partner a szervizesnek munkakörnyezet, de a
    /// törzsadatát nem ő gondozza (Balázs döntése, 2026-08-21: "a
    /// szervizesek csak lássák egyelőre"), ezért PARTNERS_MANAGE nincs.
    PERMISSIONS.PARTNERS_VIEW,
    PERMISSIONS.SERVICE_VIEW,
    PERMISSIONS.SERVICE_MANAGE,
    PERMISSIONS.AQUARIUMS_VIEW,
    PERMISSIONS.AQUARIUMS_MANAGE,
  ],
  VIEWER: VIEW_PERMISSIONS,
};

export interface AuthenticatedUser {
  id: string;
  email: string;
  /** The official, full name. Documents use this one. */
  displayName: string;
  /** What the team calls them; see `personDisplayName`. */
  nickname?: string | null;
  role: UserRole;
  avatarUrl?: string | null;
}

export interface Session {
  id: string;
  user: AuthenticatedUser;
  expiresAt: string;
  token?: string;
}

export function hasPermission(
  userOrRole: AuthenticatedUser | UserRole,
  permission: Permission,
): boolean {
  const role = typeof userOrRole === "string" ? userOrRole : userOrRole.role;
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function hasAnyPermission(
  userOrRole: AuthenticatedUser | UserRole,
  permissions: readonly Permission[],
): boolean {
  return permissions.some((permission) =>
    hasPermission(userOrRole, permission),
  );
}

export function hasAllPermissions(
  userOrRole: AuthenticatedUser | UserRole,
  permissions: readonly Permission[],
): boolean {
  return permissions.every((permission) =>
    hasPermission(userOrRole, permission),
  );
}
