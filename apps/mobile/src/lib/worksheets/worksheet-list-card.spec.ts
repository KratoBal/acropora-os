import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { worksheetCardMeta, worksheetStatTiles } from "./worksheet-list-card";

/**
 * THE WORKSHEET SCREENS OF THE SERVICE REDESIGN (Figma 423:904 and 423:918,
 * Balázs, 2026-10-04).
 */
describe("a munkalap-kártya sora", () => {
  it("Felelős nevekkel és munkaórával", () => {
    assert.equal(
      worksheetCardMeta({
        assigneeNames: ["Ádám", "Péter"],
        laborHours: "4",
        lineCount: 3,
      }),
      "Felelős: Ádám, Péter · 4 óra",
    );
    assert.equal(
      worksheetCardMeta({ assigneeNames: [], laborHours: "2.5", lineCount: 1 }),
      "Felelős: Nincs kiosztva · 2,5 óra",
    );
  });

  it("tétel nélkül gondolatjel, régi szervernél nincs óra", () => {
    assert.equal(
      worksheetCardMeta({
        assigneeNames: ["Péter"],
        laborHours: "0",
        lineCount: 0,
      }),
      "Felelős: Péter · —",
    );
    assert.equal(
      worksheetCardMeta({ assigneeNames: ["Péter"], lineCount: 2 }),
      "Felelős: Péter",
    );
  });
});

describe("a munkalap-lista csempéi", () => {
  it("egy Új és folyamatban csempe (E5), számláló nélkül semmi", () => {
    assert.equal(worksheetStatTiles(undefined), null);
    assert.deepEqual(
      worksheetStatTiles({
        DRAFT: 7,
        AWAITING_SIGNATURE: 2,
        SIGNED: 31,
        REJECTED: 1,
      })?.map((tile) => [tile.label, tile.value]),
      [
        ["Új és folyamatban", 7],
        ["Elkészült", 2],
        ["Lezárva", 31],
      ],
    );
  });
});

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}

const LIST = "src/app/worksheets/index.tsx";
const DETAIL = "src/app/worksheets/[id].tsx";

describe("a munkalap-képernyők bekötése", () => {
  it("a lista kártyája a közös sort és a hibajegy-linket rajzolja", () => {
    const s = code(LIST);
    assert.match(s, /\{worksheetCardMeta\(item\)\}/);
    assert.match(s, /pathname: "\/service-jobs\/\[id\]"/);
  });

  it("mindkét képernyő a közös alsó sávot viseli, aktív elem nélkül", () => {
    assert.match(code(LIST), /<BottomNav active=\{null\} \/>/);
    assert.match(code(DETAIL), /<BottomNav active=\{null\} \/>/);
  });

  /**
   * THE CLOSING PANEL HOLDS THE CLOSE, THE HAND-OVER AND THE SIGNATURE, and
   * its facts do not gate the close (decision E7): the condition is the one
   * the server checks, unchanged.
   */
  it("a helyszíni lezárás panel a lezárást, az átadást és az aláírást fogja össze", () => {
    const s = code(DETAIL);
    const start = s.indexOf('accessibilityLabel="Helyszíni lezárás"');
    const end = s.indexOf("Anyagigények (", start);
    assert.ok(start !== -1 && end > start, "nem találom a panelt");
    const panel = s.slice(start, end);
    assert.match(
      panel,
      /canCloseWorksheetVersion\(\{\s*status: current\.status,\s*worksheetsManage: capabilities\.worksheetsManage,\s*\}\)/,
    );
    assert.match(panel, /canMarkWorksheetHandover\(/);
    assert.match(panel, /Elküldöm aláírásra/);
    assert.match(panel, /Átadás: \{data\.handedOverAt/);
  });

  it("az összesítő nem mutat árat", () => {
    const s = code(DETAIL);
    const start = s.indexOf('accessibilityLabel="Összesítés"');
    const end = s.indexOf("</View>\n            </View>", start);
    const summary = s.slice(start, end);
    assert.ok(start !== -1, "nem találom az összesítőt");
    assert.doesNotMatch(summary, /Amount|unitNet|price|HUF/i);
    assert.match(summary, /formatWorksheetQuantity\(current\.laborHours\)/);
  });
});
