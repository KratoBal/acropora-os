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
      permission !== PERMISSIONS.USERS_MANAGE,
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
  ],
  SERVICE: [
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.TASKS_VIEW,
    PERMISSIONS.PRODUCTS_VIEW,
    PERMISSIONS.CUSTOMERS_VIEW,
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
  displayName: string;
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
