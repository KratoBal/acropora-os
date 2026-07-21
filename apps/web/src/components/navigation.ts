import { PERMISSIONS, type Permission } from "@acropora/types";
import type { IconName } from "@acropora/ui";

export interface AppNavigationItem {
  href: string;
  label: string;
  icon: IconName;
  permission: Permission;
}

export const primaryNavigation: AppNavigationItem[] = [
  {
    href: "/",
    label: "Dashboard",
    icon: "dashboard",
    permission: PERMISSIONS.DASHBOARD_VIEW,
  },
  {
    href: "/feladataim",
    label: "Feladataim",
    icon: "clipboard",
    permission: PERMISSIONS.TASKS_VIEW,
  },
];

export const businessNavigation: AppNavigationItem[] = [
  {
    href: "/webshop",
    label: "Webshop",
    icon: "store",
    permission: PERMISSIONS.ORDERS_VIEW,
  },
  {
    href: "/pos",
    label: "POS",
    icon: "credit-card",
    permission: PERMISSIONS.ORDERS_VIEW,
  },
  {
    href: "/products",
    label: "Termékek",
    icon: "package",
    permission: PERMISSIONS.PRODUCTS_VIEW,
  },
  {
    href: "/vevok",
    label: "Vevők",
    icon: "users",
    permission: PERMISSIONS.CUSTOMERS_VIEW,
  },
  {
    href: "/raktar",
    label: "Raktár",
    icon: "warehouse",
    permission: PERMISSIONS.INVENTORY_VIEW,
  },
  {
    href: "/keszlet-egyeztetes",
    label: "Készlet-egyeztetés",
    icon: "box",
    permission: PERMISSIONS.INVENTORY_VIEW,
  },
  {
    href: "/beszerzes",
    label: "Beszerzés",
    icon: "cart",
    permission: PERMISSIONS.PURCHASING_VIEW,
  },
  {
    href: "/penzugy",
    label: "Pénzügy",
    icon: "finance",
    permission: PERMISSIONS.FINANCE_VIEW,
  },
  {
    href: "/szerviz",
    label: "Szerviz",
    icon: "service",
    permission: PERMISSIONS.SERVICE_VIEW,
  },
  {
    href: "/akvariumok",
    label: "Akváriumok",
    icon: "aquarium",
    permission: PERMISSIONS.AQUARIUMS_VIEW,
  },
  {
    href: "/icp",
    label: "ICP",
    icon: "briefcase",
    permission: PERMISSIONS.ICP_VIEW,
  },
];

export const settingsNavigation: AppNavigationItem[] = [
  {
    href: "/admin/integrations/unas",
    label: "UNAS szinkron",
    icon: "activity",
    permission: PERMISSIONS.PRODUCTS_VIEW,
  },
  {
    href: "/admin/integrations/unas/connection",
    label: "UNAS kapcsolat",
    icon: "key",
    permission: PERMISSIONS.SETTINGS_MANAGE,
  },
  {
    href: "/admin/brands",
    label: "Márkák",
    icon: "package",
    permission: PERMISSIONS.PRODUCTS_VIEW,
  },
  {
    href: "/beallitasok",
    label: "Beállítások",
    icon: "settings",
    permission: PERMISSIONS.SETTINGS_MANAGE,
  },
];
