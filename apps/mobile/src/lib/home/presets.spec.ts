import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import type { TileCode } from "../auth/tile-visibility";
import type { UserRole } from "../auth/types";
import { BOTTOM_NAV_ITEMS } from "./bottom-nav";
import { HOME_MODULES, launcherModules } from "./modules";
import {
  defaultPresetFor,
  HOME_MODULE_LIMIT,
  HOME_PRESETS,
  homeModules,
  type HomePreset,
} from "./presets";

/**
 * THE MOBILE HOME V1 FRAMEWORK, PHASE 1 (docs/mobile-home/v1-discovery.md).
 *
 * What is measured here:
 * - each role starts on its view;
 * - a view orders the Home but never widens it: an unserved module is not
 *   drawn, and neither is a module without a screen;
 * - the bottom bar is one list, the same for every view;
 * - the Home lost "Legutóbbi rendelések" and kept what the brief preserves.
 *
 * Screens are read as source: this package has no component renderer.
 */

const ROLES: readonly UserRole[] = [
  "OWNER",
  "ADMIN",
  "MANAGER",
  "SALES",
  "WAREHOUSE",
  "SERVICE",
  "VIEWER",
  "PARTNER_SERVICE",
];

const ALL_SERVED = (_code: TileCode) => true;

function served(...codes: TileCode[]) {
  return (code: TileCode) => codes.includes(code);
}

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}

const HOME = join("src", "app", "index.tsx");
const MODULOK = join("src", "app", "modulok.tsx");
const PROFILE = join("src", "app", "settings.tsx");
const BOTTOM_NAV = join("src", "components", "home", "BottomNav.tsx");

describe("a kezdőlap nézete a szerepkörből jön", () => {
  it("minden szerepkörnek van nézete", () => {
    for (const role of ROLES)
      assert.ok(HOME_PRESETS[defaultPresetFor(role)], role);
  });

  it("a szerepkörök a megbeszélt nézetben indulnak", () => {
    assert.deepEqual(
      Object.fromEntries(ROLES.map((role) => [role, defaultPresetFor(role)])),
      {
        OWNER: "owner",
        ADMIN: "owner",
        MANAGER: "owner",
        SALES: "webshop",
        WAREHOUSE: "webshop",
        SERVICE: "service",
        VIEWER: "owner",
        PARTNER_SERVICE: "partner-service",
      },
    );
  });
});

describe("a nézet sorrendet ad, láthatóságot nem", () => {
  it("POZITÍV KONTROLL: minden kiszolgált modullal a nézet teljes sora látszik", () => {
    assert.deepEqual(homeModules(HOME_PRESETS.service, ALL_SERVED), [
      "HJ",
      "MU",
      "AI",
      "ES",
      "AK",
      "PA",
    ]);
  });

  it("a nem kiszolgált modul nem jelenik meg, akkor sem, ha a nézet elöl hozza", () => {
    for (const preset of Object.values(HOME_PRESETS)) {
      const first = preset.modules[0]!;
      assert.ok(
        !homeModules(preset, (c) => c !== first).includes(first),
        `${preset.id}: a ${first} nem kiszolgálva is látszik`,
      );
    }
    assert.deepEqual(homeModules(HOME_PRESETS.owner, served()), []);
  });

  it("a nézeten kívüli modul a kezdőlapon nem, a Modulok alatt igen", () => {
    const servedOnly = served("RE", "PA");
    assert.deepEqual(homeModules(HOME_PRESETS.service, servedOnly), ["PA"]);
    assert.deepEqual(launcherModules(servedOnly), ["RE", "PA"]);
  });

  it("képernyő nélküli modul sehol nem jelenik meg", () => {
    const noScreen = (Object.keys(HOME_MODULES) as TileCode[]).filter(
      (c) => HOME_MODULES[c].route === null,
    );
    assert.deepEqual(noScreen.sort(), ["BE", "NAV", "TE"]);
    const wide: HomePreset = {
      id: "owner",
      label: "teszt",
      modules: ["BE", "TE", "NAV", "HJ"],
    };
    assert.deepEqual(homeModules(wide, ALL_SERVED), ["HJ"]);
    for (const c of noScreen)
      assert.ok(!launcherModules(ALL_SERVED).includes(c), c);
  });

  it("a kezdőlap legfeljebb hat modult rajzol, a nézet sorrendjében", () => {
    const long: HomePreset = {
      id: "owner",
      label: "teszt",
      modules: ["PA", "RE", "AK", "ES", "AI", "MU", "HJ"],
    };
    assert.deepEqual(homeModules(long, ALL_SERVED), [
      "PA",
      "RE",
      "AK",
      "ES",
      "AI",
      "MU",
    ]);
    assert.equal(HOME_MODULE_LIMIT, 6);
  });

  it("minden modul útvonala létező képernyőre mutat", () => {
    for (const module of Object.values(HOME_MODULES)) {
      if (module.route === null) continue;
      const base = join("src", "app", module.route.slice(1));
      assert.ok(
        existsSync(`${base}.tsx`) || existsSync(join(base, "index.tsx")),
        `${module.title}: nincs képernyő a ${module.route} útvonalon`,
      );
    }
  });
});

describe("az alsó sáv minden nézetben ugyanaz", () => {
  it("három elem, rögzített sorrendben, létező képernyőkre", () => {
    assert.deepEqual(
      BOTTOM_NAV_ITEMS.map((item) => [item.key, item.label, item.route]),
      [
        ["home", "Kezdőlap", "/"],
        ["modules", "Modulok", "/modulok"],
        ["profile", "Profil", "/settings"],
      ],
    );
  });

  /**
   * The list is a constant, so it cannot differ per view by itself. What
   * could make it differ is the component: it takes only `active` and
   * renders `BOTTOM_NAV_ITEMS` as they are, with no filter and no view.
   */
  it("a sáv komponense nem kap nézetet, és nem szűr", () => {
    const source = code(BOTTOM_NAV);
    assert.match(source, /BOTTOM_NAV_ITEMS\.map\(/);
    assert.doesNotMatch(
      source,
      /BOTTOM_NAV_ITEMS\.filter|\bpresets?\b|\brole\b/i,
    );
    assert.match(
      source,
      // its only input is which item is lit, or none on the service screens
      /export function BottomNav\(\{\s*active,?\s*\}:\s*\{\s*active: BottomNavItem\["key"\] \| null;\s*\}\)/,
    );
  });

  it("mindhárom képernyő a sávot viseli, a saját elemével", () => {
    assert.match(code(HOME), /<BottomNav active="home" \/>/);
    assert.match(code(MODULOK), /<BottomNav active="modules" \/>/);
    assert.match(code(PROFILE), /<BottomNav active="profile" \/>/);
  });
});

describe("a kezdőlap tartalma az 1. fázis után", () => {
  const home = code(HOME);

  it("a Legutóbbi rendelések szakasz kikerült", () => {
    assert.doesNotMatch(home, /Legutóbbi rendelések/);
    assert.doesNotMatch(home, /listUnasOrders|OrderListCard|useQuery/);
  });

  it("a csempéket a nézet és a szerver menüje adja", () => {
    assert.match(home, /homeModules\(preset, tileVisible\)/);
    assert.match(home, /HOME_PRESETS\[defaultPresetFor\(user\.role\)\]/);
  });

  it("megmaradt: offline sávok, nulla-csempe kártya, helyszín-letöltő, verzió", () => {
    assert.match(home, /useQueueDrain\(isOnline\)/);
    assert.match(home, /describeOfflineSession\(/);
    assert.match(home, /onPress=\{retryRestore\}/);
    assert.match(home, /<HelyszinLetolto \/>/);
    assert.match(home, /runningVersionLine\(/);
  });

  it("a kijelentkezés a Profil képernyőn van", () => {
    assert.doesNotMatch(home, /signOut/);
    assert.match(code(PROFILE), /onPress=\{\(\) => void signOut\(\)\}/);
  });

  it("az Összes a Modulok képernyőt nyitja", () => {
    assert.match(home, /router\.push\("\/modulok"\)/);
    assert.match(code(MODULOK), /launcherModules\(/);
  });
});
