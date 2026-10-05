/**
 * THE BOTTOM BAR: THE SAME FOR EVERY PRESET (mobile Home V1, acrobot note 11:
 * "The bottom navigation is identical for every preset"). It is one constant
 * list, and nothing about the user or the preset is an input to it.
 *
 * Phase 1 has three items, and Üzenetek joined them with the Messages module. "Feladatok" (the user's own open items) joins in
 * phase 2, together with the data behind it; until then it would be an item
 * that leads nowhere (owner, answer 4).
 *
 * Profil is the existing settings screen.
 */
export interface BottomNavItem {
  key: "home" | "modules" | "messages" | "profile";
  label: string;
  /** An Ionicons glyph name. */
  icon: string;
  route: "/" | "/modulok" | "/uzenetek" | "/settings";
}

export const BOTTOM_NAV_ITEMS: readonly BottomNavItem[] = [
  { key: "home", label: "Kezdőlap", icon: "home-outline", route: "/" },
  { key: "modules", label: "Modulok", icon: "grid-outline", route: "/modulok" },
  // AZ ÜZENETEK (kártya 51d7aba0, Figma 443:235): a Profil előtt, mint a terven
  {
    key: "messages",
    label: "Üzenetek",
    icon: "chatbubble-outline",
    route: "/uzenetek",
  },
  {
    key: "profile",
    label: "Profil",
    icon: "person-circle-outline",
    route: "/settings",
  },
];
