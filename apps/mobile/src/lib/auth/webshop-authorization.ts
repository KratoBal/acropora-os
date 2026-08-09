import type { UserRole } from "./types";

export interface WebshopCapabilities {
  workspace: boolean;
  ordersView: boolean;
  ordersManage: boolean;
  purchasingView: boolean;
  purchasingManage: boolean;
  productsView: boolean;
  productsManage: boolean;
  navView: boolean;
  navManage: boolean;
  partnersView: boolean;
  partnersManage: boolean;
}

const FULL_ACCESS: WebshopCapabilities = {
  workspace: true,
  ordersView: true,
  ordersManage: true,
  purchasingView: true,
  purchasingManage: true,
  productsView: true,
  productsManage: true,
  navView: true,
  navManage: true,
  partnersView: true,
  partnersManage: true,
};

/**
 * App-local mirror of the webshop-related subset of
 * `packages/types/src/auth.ts`. The Expo app intentionally does not import
 * pnpm workspace packages (see `types.ts` and docs/MOBILE-DEVELOPMENT.md).
 *
 * This is a presentation gate only. Every API endpoint still enforces the
 * canonical server-side permission before returning or changing data.
 */
const ROLE_CAPABILITIES: Readonly<Record<UserRole, WebshopCapabilities>> = {
  OWNER: FULL_ACCESS,
  ADMIN: FULL_ACCESS,
  MANAGER: {
    ...FULL_ACCESS,
  },
  SALES: {
    workspace: true,
    ordersView: true,
    ordersManage: true,
    purchasingView: false,
    purchasingManage: false,
    productsView: true,
    productsManage: false,
    navView: false,
    navManage: false,
    partnersView: false,
    partnersManage: false,
  },
  WAREHOUSE: {
    workspace: true,
    ordersView: true,
    ordersManage: false,
    purchasingView: true,
    purchasingManage: true,
    productsView: true,
    productsManage: false,
    navView: true,
    navManage: true,
    partnersView: true,
    partnersManage: true,
  },
  SERVICE: {
    workspace: false,
    ordersView: false,
    ordersManage: false,
    purchasingView: false,
    purchasingManage: false,
    productsView: true,
    productsManage: false,
    navView: false,
    navManage: false,
    partnersView: false,
    partnersManage: false,
  },
  VIEWER: {
    workspace: true,
    ordersView: true,
    ordersManage: false,
    purchasingView: true,
    purchasingManage: false,
    productsView: true,
    productsManage: false,
    navView: true,
    navManage: false,
    partnersView: true,
    partnersManage: false,
  },
};

export function getWebshopCapabilities(role: UserRole): WebshopCapabilities {
  return ROLE_CAPABILITIES[role];
}

export function userRoleLabel(role: UserRole): string {
  const labels: Record<UserRole, string> = {
    OWNER: "Tulajdonos",
    ADMIN: "Adminisztrátor",
    MANAGER: "Manager",
    SALES: "Értékesítés",
    WAREHOUSE: "Raktár",
    SERVICE: "Szerviz",
    VIEWER: "Megtekintő",
  };
  return labels[role];
}
