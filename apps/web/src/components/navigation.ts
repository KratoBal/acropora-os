import type { IconName } from "@acropora/ui";

export interface AppNavigationItem {
  href: string;
  label: string;
  icon: IconName;
}

export const primaryNavigation: AppNavigationItem[] = [
  { href: "/", label: "Dashboard", icon: "dashboard" },
  { href: "/feladataim", label: "Feladataim", icon: "clipboard" },
];

export const businessNavigation: AppNavigationItem[] = [
  { href: "/webshop", label: "Webshop", icon: "store" },
  { href: "/pos", label: "POS", icon: "credit-card" },
  { href: "/termekek", label: "Termékek", icon: "package" },
  { href: "/vevok", label: "Vevők", icon: "users" },
  { href: "/raktar", label: "Raktár", icon: "warehouse" },
  { href: "/beszerzes", label: "Beszerzés", icon: "cart" },
  { href: "/penzugy", label: "Pénzügy", icon: "finance" },
  { href: "/szerviz", label: "Szerviz", icon: "service" },
  { href: "/akvariumok", label: "Akváriumok", icon: "aquarium" },
  { href: "/icp", label: "ICP", icon: "briefcase" },
];

export const settingsNavigation: AppNavigationItem[] = [
  { href: "/beallitasok", label: "Beállítások", icon: "settings" },
];
