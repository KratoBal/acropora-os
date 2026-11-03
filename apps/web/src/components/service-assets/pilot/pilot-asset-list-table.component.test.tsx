import { describe, expect, it, vi } from "vitest";

// The page's imports reach the Inter font loader, which only runs inside Next.
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));

import { ASSET_COLUMNS, ASSET_TABLE_MIN_WIDTH } from "./pilot-asset-list-page";

/*
  AZ ESZKÖZLISTA TÁBLÁJA A KÖZÖS TÁBLÁN (UI-áttekintés, 3. csomag, 2026-11-03). MI PIROSÍT: ha az
  Eszköz oszlop újra keskeny (a hosszú azonosító, ESZK-...-FAN-..., 6-8 sorra tört a stage-fotón);
  ha az oszlopok összege nagyobb a tábla minimumánál (a tábla ilyenkor a minimum fölé nőne, és
  az oldal vízszintesen görgetne a szükségesnél tovább); ha az oszlopfejlécek elvesznek (a
  telefonos kártya a fejlécből veszi a feliratot).
*/
const px = (width: string | undefined) => {
  const m = /^(\d+)px$/.exec(width ?? "");
  if (!m) throw new Error(`nem px szélesség: ${width}`);
  return Number(m[1]);
};

describe("az eszközlista oszlopai", () => {
  it("a fejlécek a régiek, így a telefonos kártya felirata is", () => {
    expect(ASSET_COLUMNS.map((c) => c.header)).toEqual([
      "Eszköz",
      "Partner",
      "Alegység",
      "Kategória",
      "Gyártó és modell",
      "Hierarchia",
      "Státusz",
    ]);
  });

  it("az Eszköz oszlop elég széles a hosszú azonosítóhoz", () => {
    expect(px(ASSET_COLUMNS[0]!.width)).toBeGreaterThanOrEqual(280);
  });

  it("az oszlopok összege belefér a tábla minimumába", () => {
    const sum = ASSET_COLUMNS.reduce((acc, c) => acc + px(c.width), 0);
    expect(sum).toBeLessThanOrEqual(ASSET_TABLE_MIN_WIDTH);
  });
});
