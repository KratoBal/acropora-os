import { PERMISSIONS, type Permission } from "@acropora/types";
import type { IconName } from "@acropora/ui";

export interface AppNavigationItem {
  href: string;
  label: string;
  icon: IconName;
  permission: Permission;
  exact?: boolean;
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
    label: "Webshop vásárló",
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
    href: "/partnerek",
    label: "Partnerek",
    icon: "truck",
    permission: PERMISSIONS.PURCHASING_VIEW,
  },
  {
    href: "/beszerzes/nav-szamlak",
    label: "NAV számla lekérés",
    icon: "download",
    permission: PERMISSIONS.PURCHASING_VIEW,
  },
  {
    href: "/penzugy",
    label: "Pénzügy",
    icon: "finance",
    permission: PERMISSIONS.FINANCE_VIEW,
    exact: true,
  },
  {
    href: "/penzugy/foxpost",
    label: "Foxpost elszámolás",
    icon: "download",
    permission: PERMISSIONS.FINANCE_VIEW,
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

export const serviceNavigation: AppNavigationItem[] = [
  {
    href: "/szerviz/munkalapok",
    label: "Munkalapok",
    icon: "clipboard",
    permission: PERMISSIONS.SERVICE_VIEW,
  },
  {
    href: "/szerviz/eszkozok",
    label: "Eszköznyilvántartás",
    icon: "box",
    permission: PERMISSIONS.SERVICE_VIEW,
  },
];

export const unasSettingsNavigation: AppNavigationItem[] = [
  {
    href: "/admin/integrations/unas/connection",
    label: "Kapcsolat",
    icon: "key",
    permission: PERMISSIONS.SETTINGS_MANAGE,
  },
  {
    href: "/admin/integrations/unas",
    label: "Szinkron",
    icon: "activity",
    permission: PERMISSIONS.PRODUCTS_VIEW,
    exact: true,
  },
];

export const secondaryNavigation: AppNavigationItem[] = [
  {
    href: "/admin/brands",
    label: "Márkák",
    icon: "package",
    permission: PERMISSIONS.PRODUCTS_VIEW,
  },
];

export const settingsNavigation: AppNavigationItem[] = [
  {
    href: "/beallitasok",
    label: "Általános",
    icon: "settings",
    permission: PERMISSIONS.SETTINGS_MANAGE,
  },
  {
    href: "/admin/integrations/nav",
    label: "NAV",
    icon: "finance",
    permission: PERMISSIONS.SETTINGS_MANAGE,
  },
  {
    href: "/admin/users",
    label: "Felhasználók",
    icon: "shield",
    permission: PERMISSIONS.USERS_MANAGE,
  },
];

export const allSettingsNavigation: AppNavigationItem[] = [
  ...unasSettingsNavigation,
  ...settingsNavigation,
];

export function isNavigationItemActive(
  pathname: string,
  item: AppNavigationItem,
) {
  return (
    pathname === item.href ||
    (!item.exact && pathname.startsWith(`${item.href}/`))
  );
}
