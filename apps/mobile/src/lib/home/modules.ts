import type { TileCode } from "../auth/tile-visibility";

/**
 * EVERY MODULE THE HOME AND THE MODULE LAUNCHER CAN SHOW, IN ONE PLACE
 * (mobile Home V1, docs/mobile-home/v1-discovery.md; Figma 412:3).
 *
 * Whether a module is shown is still the server's decision: a tile appears
 * only when its navigation entry was served (`tileVisible`). This table only
 * says what a module looks like and where it leads.
 *
 * A MODULE WITH NO SCREEN IS NOT A TILE (owner, 2026-10-02, answer 4: "Olyan
 * csempe ne legyen, ami sehova nem visz"). Beszerzés, Termékek and NAV have
 * no mobile screen yet, so `route` is `null` and they appear nowhere; they
 * keep their navigation entry (`TILE_ENTRY`), so the day a screen exists,
 * only this table changes.
 *
 * ICONS are Ionicons outline glyphs from `@expo/vector-icons` (owner, answer
 * 6), drawn by `components/home/ModuleIcon`. No emoji, no letter marks.
 */
export interface HomeModule {
  title: string;
  /** A short, static line under the title: what the module is for. */
  description: string;
  /** An Ionicons glyph name. */
  icon: string;
  /** Where the tile leads; `null` while the module has no mobile screen. */
  route: string | null;
}

export const HOME_MODULES: Readonly<Record<TileCode, HomeModule>> = {
  HJ: {
    title: "Hibajegyek",
    description: "Nyitott jegyek, léptetés és fénykép a helyszínen",
    icon: "ticket-outline",
    route: "/service-jobs",
  },
  MU: {
    title: "Munkalapok",
    description: "Kiosztott lapok, tételek és felelősök",
    icon: "document-text-outline",
    route: "/worksheets",
  },
  AI: {
    title: "Anyagigények",
    description: "Rád váró anyagigények, beérkezés jelölése",
    icon: "cube-outline",
    route: "/material-requests",
  },
  ES: {
    title: "Eszközök",
    description: "Partnereszközök, QR-azonosítás és hierarchia",
    icon: "build-outline",
    route: "/assets",
  },
  AK: {
    title: "Akváriumok",
    description: "Saját és ügyfél akváriumai, méretek és eszközök",
    icon: "fish-outline",
    route: "/aquariums",
  },
  PI: {
    title: "Piszkozatok",
    description: "Cápasuli kérések elbírálása: elfogadás vagy elvetés",
    icon: "mail-unread-outline",
    route: "/service-drafts",
  },
  RE: {
    title: "Rendelések",
    description: "UNAS rendelések, státuszok és tételek",
    icon: "cart-outline",
    route: "/orders",
  },
  PA: {
    title: "Partnerek",
    description: "Szerviz partnerek és kapcsolattartók",
    icon: "people-outline",
    route: "/partners",
  },
  BE: {
    title: "Beszerzés",
    description: "Szállítói számlák és bevételezés",
    icon: "receipt-outline",
    route: null,
  },
  TE: {
    title: "Termékek",
    description: "Terméktörzs és készletállapot",
    icon: "pricetag-outline",
    route: null,
  },
  NAV: {
    title: "NAV-szinkron",
    description: "Bejövő számlák és párosítások",
    icon: "swap-horizontal-outline",
    route: null,
  },
};

/** The launcher's order: every module, the service chain first. */
export const MODULE_ORDER: readonly TileCode[] = [
  "HJ",
  "MU",
  "AI",
  "ES",
  "AK",
  "PI",
  "RE",
  "PA",
  "BE",
  "TE",
  "NAV",
];

/**
 * Every module this user may open: served by the server AND with a screen,
 * in launcher order. This is the Modulok screen.
 */
export function launcherModules(
  served: (code: TileCode) => boolean,
): TileCode[] {
  return MODULE_ORDER.filter(
    (code) => served(code) && HOME_MODULES[code].route !== null,
  );
}
