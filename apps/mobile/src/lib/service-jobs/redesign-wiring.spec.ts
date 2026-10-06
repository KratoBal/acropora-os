import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * THE SERVICE REDESIGN'S WIRING ON THE TWO JOB SCREENS (Figma 423:876 and
 * 423:890, 2026-10-04). The phone has no screen renderer, so the source is
 * read: these are the lines a redesign could drop without any other test
 * noticing.
 */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}

const LIST = "src/app/service-jobs/index.tsx";
const DETAIL = "src/app/service-jobs/[id].tsx";

describe("a hibajegy-képernyők a redesign után", () => {
  // a partner is shown the names too (card a0660885, acrobot 26185): no partner gate on the line
  it("a lista kártyája a felelős-sort partnernek is kirajzolja", () => {
    const s = code(LIST);
    assert.match(s, /serviceJobCardMeta\(item, now\)/);
    assert.doesNotMatch(s, /viewerIsPartner/);
  });

  it("a mentett másolatból a rám kiosztva a felhasználóval szűr", () => {
    assert.match(
      code(LIST),
      /cachedItemsForScope\(cachedItems, scope, user\?\.id\)/,
    );
  });

  it("az adatlap csak belső alaknál mutat felelőst és partner-állapotot", () => {
    const s = code(DETAIL);
    assert.match(
      s,
      /!partnerAlak\(detail\) \? \(\s*<Text style=\{styles\.meta\}>\s*\{serviceJobAssigneeLine\(\{ assignees: detail\.assignees \}\)\}/,
    );
    assert.match(s, /Partner: \{detail\.partnerStatusLabel\}/);
  });

  it("a következő lépés csak a szerver lépéseiből rajzol", () => {
    const s = code(DETAIL);
    assert.match(
      s,
      /const lephet = masolatbol \|\| partnerAlak\(detail\) \? \[\] : detail\.allowedSteps;/,
    );
    assert.match(s, /\{lephet\.map\(\(to\) => \(/);
    assert.match(s, /<SectionTitle>Következő lépés<\/SectionTitle>/);
  });

  it("mindkét képernyő a közös alsó sávot viseli, aktív elem nélkül", () => {
    assert.match(code(LIST), /<BottomNav active=\{null\} \/>/);
    assert.match(code(DETAIL), /<BottomNav active=\{null\} \/>/);
  });
});
