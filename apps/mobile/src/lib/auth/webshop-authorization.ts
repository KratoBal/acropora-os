import type { UserRole } from "./types";

export interface WebshopCapabilities {
  workspace: boolean;
  ordersView: boolean;
  ordersManage: boolean;
  purchasingView: boolean;
  purchasingManage: boolean;
  productsView: boolean;
  productsManage: boolean;
  partnersView: boolean;
  partnersManage: boolean;
}

export interface ServiceCapabilities {
  workspace: boolean;
  assetsView: boolean;
  assetsManage: boolean;
}

const FULL_ACCESS: WebshopCapabilities = {
  workspace: true,
  ordersView: true,
  ordersManage: true,
  purchasingView: true,
  purchasingManage: true,
  productsView: true,
  productsManage: true,
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
 *
 * The mirror is only as good as the names. `partnersView` and `partnersManage`
 * had no counterpart on the server at all until `partners.view` and
 * `partners.manage` were introduced: the two sides claimed to agree while
 * naming different things, and nothing here would have said so.
 *
 * `navView` and `navManage` used to sit here in that same state, and they are
 * gone (2026-08-26). They were named after a MODULE (the tax authority), while
 * the server grants rights per OPERATION: setting up the NAV connection needs
 * `settings.manage`, the taxpayer lookup needs `customers.manage`, and the
 * incoming invoices -- the thing the tile actually promised -- need
 * `purchasing.view`. One client-side name could not mirror three server
 * permissions, so renaming it would only have looked like a fix. When the
 * screen is built, it will use the key belonging to the call it makes.
 *
 * Every key that remains has a server-side counterpart, and that is asserted:
 * see `apps/api/src/auth/mobile-capability-mirror.spec.ts`.
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
    /** Service partners are the technician's working context, so the list is
     * visible from the phone. Editing is not: the owner's decision was "let
     * the service staff just see it for now" (2026-08-21), which the server
     * enforces by granting SERVICE `partners.view` and not `partners.manage`. */
    partnersView: true,
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
    partnersView: true,
    partnersManage: false,
  },
};

export function getWebshopCapabilities(role: UserRole): WebshopCapabilities {
  return ROLE_CAPABILITIES[role];
}

export function getServiceCapabilities(role: UserRole): ServiceCapabilities {
  const canView =
    role === "OWNER" ||
    role === "ADMIN" ||
    role === "MANAGER" ||
    role === "SERVICE" ||
    role === "VIEWER";
  return {
    workspace: canView,
    assetsView: canView,
    assetsManage:
      role === "OWNER" ||
      role === "ADMIN" ||
      role === "MANAGER" ||
      role === "SERVICE",
  };
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
