import type { TileCode } from "../auth/tile-visibility";
import type { UserRole } from "../auth/types";
import { HOME_MODULES } from "./modules";

/**
 * THE HOME PRESETS: WHAT COMES FIRST, NOT WHAT IS ALLOWED (mobile Home V1,
 * docs/mobile-home/v1-discovery.md §9; Figma 412:3).
 *
 * A preset decides the order and the handful of modules the Home leads with.
 * It never decides what a user may see: a module is shown only when the
 * server served its navigation entry, and only if it has a screen. A user
 * whose permissions span other modules still finds them under Modulok.
 *
 * PHASE 1 (this file's first version): the preset comes from the role alone,
 * and there is no switching yet. The view chip, the choice stored on the
 * device and the presets' own data (focus card, "Figyelmet igényel") are
 * phase 2.
 */
export type HomePresetId = "owner" | "webshop" | "service" | "partner-service";

export interface HomePreset {
  id: HomePresetId;
  /** The chip on the Home: "Szerviz nézet". */
  label: string;
  /** The modules the Home leads with, in order (at most six are drawn). */
  modules: readonly TileCode[];
}

export const HOME_PRESETS: Readonly<Record<HomePresetId, HomePreset>> = {
  service: {
    id: "service",
    label: "Szerviz nézet",
    modules: ["HJ", "MU", "AI", "ES", "AK", "PA"],
  },
  webshop: {
    id: "webshop",
    label: "Webshop nézet",
    // Termékek, Készlet, Beszerzés and NAV have no mobile screen (answer 4)
    modules: ["RE", "PA"],
  },
  owner: {
    id: "owner",
    label: "Tulajdonosi nézet",
    modules: ["RE", "HJ", "MU", "AI", "ES", "AK"],
  },
  "partner-service": {
    id: "partner-service",
    label: "Partner szerviz",
    modules: ["HJ", "MU", "AI", "ES", "AK"],
  },
};

/** The most the Home draws; the rest is one tap away under Modulok. */
export const HOME_MODULE_LIMIT = 6;

export function defaultPresetFor(role: UserRole): HomePresetId {
  switch (role) {
    case "OWNER":
    case "ADMIN":
    case "MANAGER":
    case "VIEWER":
      return "owner";
    case "SALES":
    case "WAREHOUSE":
      return "webshop";
    case "SERVICE":
      return "service";
    case "PARTNER_SERVICE":
      return "partner-service";
  }
}

/**
 * The tiles the Home draws for this preset: the preset's modules that the
 * server served and that have a screen, in the preset's order, at most six.
 */
export function homeModules(
  preset: HomePreset,
  served: (code: TileCode) => boolean,
): TileCode[] {
  return preset.modules
    .filter((code) => served(code) && HOME_MODULES[code].route !== null)
    .slice(0, HOME_MODULE_LIMIT);
}
