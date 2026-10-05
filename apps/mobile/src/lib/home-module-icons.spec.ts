import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { BOTTOM_NAV_ITEMS } from "./home/bottom-nav";
import { HOME_MODULES } from "./home/modules";

/**
 * THE HOME'S ICONS ARE IONICONS OUTLINE GLYPHS (mobile Home V1, owner's
 * answer 6, 2026-10-02): no emoji and no letter marks.
 *
 * This replaces the earlier pin on the emoji per module
 * (`exchange/figma-telefon-make-12`), which the V1 design retires.
 *
 * WHY THE GLYPH MAP IS READ: `Ionicons` takes any string as `name` at runtime
 * and draws a "?" box for an unknown one, and the type only helps where the
 * name is a literal. The names live in tables, so this spec checks each one
 * against the map the installed package ships.
 */
const GLYPH_MAP = join(
  "node_modules",
  "@expo",
  "vector-icons",
  "build",
  "vendor",
  "react-native-vector-icons",
  "glyphmaps",
  "Ionicons.json",
);

/** Every Ionicons name the Home, the launcher and the bottom bar draw. */
function usedIcons(): string[] {
  const tileChevron = readFileSync(
    join("src", "components", "home", "ModuleTile.tsx"),
    "utf8",
  ).match(/name="([a-z-]+)"/g);
  return [
    ...Object.values(HOME_MODULES).map((module) => module.icon),
    ...BOTTOM_NAV_ITEMS.map((item) => item.icon),
    ...(tileChevron ?? []).map((match) => match.slice(6, -1)),
  ];
}

/** Source with comments removed, so a comment cannot satisfy a check. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}

const SCREENS = [
  join("src", "app", "index.tsx"),
  join("src", "app", "modulok.tsx"),
  join("src", "app", "settings.tsx"),
  join("src", "app", "_layout.tsx"),
  join("src", "components", "home", "ModuleTile.tsx"),
  join("src", "components", "home", "BottomNav.tsx"),
];

describe("a kezdőlap ikonjai", () => {
  const glyphs = JSON.parse(readFileSync(GLYPH_MAP, "utf8")) as Record<
    string,
    number
  >;

  it("POZITÍV KONTROLL: a glyph-térkép és a használt nevek nem üresek", () => {
    assert.ok(Object.keys(glyphs).length > 1000);
    // Ten modules, four bottom-bar items and the tile's chevron.
    // 15 since the Üzenetek item joined the bottom bar (card 51d7aba0)
    assert.equal(usedIcons().length, 15);
  });

  it("minden használt ikonnév létezik az Ionicons készletben", () => {
    assert.deepEqual(
      usedIcons().filter((name) => !(name in glyphs)),
      [],
      "ismeretlen Ionicons név: a telefon egy kérdőjeles dobozt rajzolna",
    );
  });

  it("minden ikon körvonalas (outline), a nyíl kivételével", () => {
    assert.deepEqual(
      usedIcons().filter(
        (name) => !name.endsWith("-outline") && name !== "chevron-forward",
      ),
      [],
    );
  });

  it("nincs emoji a kezdőlap képernyőin", () => {
    for (const path of SCREENS)
      assert.doesNotMatch(
        code(path),
        /\p{Extended_Pictographic}/u,
        `${path}: emoji a forrásban`,
      );
  });
});

/**
 * TWO TILES TO A ROW (Balázs, 2026-09-25 18:25, kept by the V1 tile): the
 * grid wraps, and the tile has a fixed half width, not `flex: 1`, so the last
 * tile of an odd count does not stretch across the row.
 */
describe("a modul-csempék két oszlopban állnak", () => {
  it("a kezdőlap és a Modulok rácsa sortörő", () => {
    for (const path of [SCREENS[0]!, SCREENS[1]!]) {
      const block = code(path).match(/modules:\s*\{[^}]*\}/)?.[0];
      assert.ok(block, `${path}: nem találom a \`modules\` stílust`);
      assert.match(block!, /flexWrap:\s*"wrap"/);
    }
  });

  it("a csempe rögzített fél szélességű, nem `flex: 1`", () => {
    const block = code(SCREENS[4]!).match(/tile:\s*\{[^}]*\}/)?.[0];
    assert.ok(block, "nem találom a `tile` stílust");
    assert.match(block!, /width:\s*"48%"/);
    assert.doesNotMatch(block!, /flex:\s*1/);
  });
});

/**
 * THE HOME DRAWS ITS OWN HEADER (Figma 412:3): the navigator's header is
 * hidden for the index screen, and the gear button it carried is gone; the
 * profile opens from the initials and from the bottom bar.
 */
describe("a kezdőlap fejléce a tartalomban áll", () => {
  const layout = code(SCREENS[3]!);

  it("az index képernyő navigátor-fejléce rejtett", () => {
    const block = layout.match(/<Stack\.Screen\s+name="index"[\s\S]*?\/>/)?.[0];
    assert.ok(block, "nem találom az index Stack.Screen-t");
    assert.match(block!, /headerShown:\s*false/);
    assert.doesNotMatch(block!, /headerRight:/);
  });

  it("a Modulok képernyő be van jegyezve", () => {
    assert.match(layout, /<Stack\.Screen\s+name="modulok"/);
  });
});
