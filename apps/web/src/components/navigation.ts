import { PERMISSIONS, type Permission } from "@acropora/types";
import type { IconName } from "@acropora/ui";

export interface AppNavigationItem {
  href: string;
  label: string;
  icon: IconName;
  permission: Permission;
  exact?: boolean;
}

/**
 * A menu heading that opens to reveal its own pages.
 *
 * A group carries no `href` on purpose: its heading opens and closes the
 * group, and a heading that both navigated and toggled would do one of the
 * two by accident on every click. Everything reachable is a child.
 *
 * Permission lives on the children, not here. A group is shown when at least
 * one of its children is, which keeps the rule in one place: if somebody may
 * not see any page under a heading, the heading is not there either.
 */
export interface AppNavigationGroup {
  label: string;
  icon: IconName;
  children: AppNavigationItem[];
}

export type AppNavigationEntry = AppNavigationItem | AppNavigationGroup;

export function isNavigationGroup(
  entry: AppNavigationEntry,
): entry is AppNavigationGroup {
  return "children" in entry;
}

/**
 * Every page in a list, with the groups opened out.
 *
 * Anything that asks "which pages are there" wants this rather than the raw
 * list: a group is a heading, it has no `href` and no permission of its own,
 * so counting it as a page would leave the pages underneath it uncounted. The
 * user editor's permission preview is the one that would have gone quiet.
 */
export function navigationItems(
  entries: AppNavigationEntry[],
): AppNavigationItem[] {
  return entries.flatMap((entry) =>
    isNavigationGroup(entry) ? entry.children : [entry],
  );
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

/**
 * A TARTALOM SAJÁT MENÜPONT, NEM EGY MEGLÉVŐ ALATT.
 *
 * A panasz, amiből készült, épp az volt, hogy a dolgok sok felületen
 * keletkeznek, és nem látszik, mi vár kire. Egy almenü egy másik szakasz alatt
 * ugyanazt csinálná: aki nem keresi, nem találja meg.
 */
export const contentNavigation: AppNavigationItem[] = [
  {
    href: "/tartalom",
    label: "Tartalom",
    icon: "clipboard",
    permission: PERMISSIONS.CONTENT_VIEW,
  },
];

export const businessNavigation: AppNavigationEntry[] = [
  {
    href: "/pos",
    label: "POS",
    icon: "credit-card",
    permission: PERMISSIONS.ORDERS_VIEW,
  },
  {
    label: "Webshop",
    icon: "store",
    children: [
      {
        // The page behind /webshop is the order list, and that is what it is
        // called here. "Webshop" is the heading above it now.
        href: "/webshop",
        label: "Megrendelések",
        icon: "cart",
        permission: PERMISSIONS.ORDERS_VIEW,
      },
      {
        href: "/vevok",
        label: "Webshop vásárlók",
        icon: "users",
        permission: PERMISSIONS.CUSTOMERS_VIEW,
      },
      {
        // The shop's own view of the catalogue. The full internal catalogue,
        // with the barcode editor, stays at /products under "Termékek".
        href: "/webshop/termekek",
        label: "Webshop termékek",
        icon: "package",
        permission: PERMISSIONS.PRODUCTS_VIEW,
      },
    ],
  },
  {
    href: "/products",
    label: "Termékek",
    icon: "package",
    permission: PERMISSIONS.PRODUCTS_VIEW,
  },
  {
    // A JOG ITT KORABBAN `purchasing.view` VOLT, ES AZ ANOMALIA VOLT, nem
    // szigor: az OLDAL `partners.view`-t ellenoriz, a szerver ugyanazt kovetel
    // meg, es a SERVICE szerep AZT MEGKAPJA. Vagyis a szerelo a menuben nem
    // latta, de a cim beirasaval megnyitotta, es MUKODOTT -- lathatatlan es
    // nyitva. A csere egyetlen szerepet mozdit (merve: a SERVICE megkapja a
    // menupontot, es senki nem veszti el), es a menut ahhoz igazitja, amit az
    // oldal amugy is enged.
    href: "/partnerek",
    label: "Partnerek",
    icon: "truck",
    permission: PERMISSIONS.PARTNERS_VIEW,
  },
  {
    label: "Pénzügy",
    icon: "finance",
    children: [
      {
        href: "/beszerzes",
        label: "Beszerzés",
        icon: "cart",
        permission: PERMISSIONS.PURCHASING_VIEW,
      },
      {
        href: "/beszerzes/nav-szamlak",
        label: "NAV számla lekérés",
        icon: "download",
        permission: PERMISSIONS.PURCHASING_VIEW,
      },
      {
        href: "/penzugy/foxpost",
        label: "Foxpost elszámolás",
        icon: "download",
        permission: PERMISSIONS.FINANCE_VIEW,
      },
      {
        // Ide KÖLTÖZÖTT a korábbi felső szintű "Raktár", és a lap tartalma
        // szerint kapta a nevét: készletleltárak indítása és korrekciója. Az
        // útvonal nem változott, csak a menüben elfoglalt helye és a felirata.
        href: "/raktar",
        label: "Leltár",
        icon: "warehouse",
        permission: PERMISSIONS.INVENTORY_VIEW,
      },
      {
        href: "/keszlet-egyeztetes",
        label: "Készlet-egyeztetés",
        icon: "box",
        permission: PERMISSIONS.INVENTORY_VIEW,
      },
    ],
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
  // Service was already a group on screen, wired by hand in the shell. It is
  // listed here now so every group in this menu comes from one place; the
  // rendering does not care which of them is which.
  { label: "Szerviz", icon: "service", children: serviceNavigation },
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
    // Belső próbafelület, nem üzemi oldal: ezért NEM az operatív blokkban van,
    // hanem itt. A jogosultságot minden szerepkör megkapja (Balázs döntése,
    // 2026-08-26), a szűkítés a felhasználói jogosultságok rendezésekor jön.
    href: "/ai-teszt",
    label: "AI teszt",
    icon: "activity",
    permission: PERMISSIONS.AI_TEST_VIEW,
  },
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
    // A webshop-motor admin kulcsa. A NAV mellett a helye, mert mind a kettő
    // külső rendszer hitelesítő adata, és ugyanaz a jog kezeli.
    href: "/admin/integrations/medusa/connection",
    label: "Medusa kapcsolat",
    icon: "store",
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

/**
 * Whether this entry is the one the reader is on.
 *
 * A page below an entry's path counts as that entry: a single order is still
 * "Megrendelések". But a path can sit below two entries at once, and then the
 * more specific one owns it - `/beszerzes/nav-szamlak` is the NAV invoices,
 * not purchasing, and `/webshop/termekek` is the webshop products, not the
 * order list. Without `others` the outer entry lights up as well, and two
 * headings in the same group look equally current.
 *
 * `exact` stays for the case the paths cannot express: an entry that owns its
 * own page and nothing underneath it.
 */
export function isNavigationItemActive(
  pathname: string,
  item: AppNavigationItem,
  others: AppNavigationItem[] = [],
) {
  if (pathname === item.href) return true;
  if (item.exact) return false;
  if (!pathname.startsWith(`${item.href}/`)) return false;

  return !others.some(
    (other) =>
      other.href.length > item.href.length &&
      (pathname === other.href || pathname.startsWith(`${other.href}/`)),
  );
}
