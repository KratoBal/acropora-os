import { describe, expect, it, vi } from "vitest";

// The page's imports reach the Inter font loader, which only runs inside Next.
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));

import {
  AQUARIUM_COLUMNS,
  AQUARIUM_TABLE_MIN_WIDTH,
} from "./pilot-aquarium-list-page";

/*
  AZ AKVÁRIUMLISTA TÁBLÁJA A KÖZÖS TÁBLÁN (UI-áttekintés, 3. csomag, 2026-11-03). MI PIROSÍT: ha egy
  oszlopfejléc elvész vagy átíródik (a telefonos kártya a fejlécből veszi a feliratot); ha az
  oszlopok összege nagyobb a tábla minimumánál; ha az "Utolsó vízmérés" és a "Liter" újra sorba
  törhet (a stage-fotón a dátum a kártya szélén levágva állt); ha a Liter oszlop nem jobbra zárt.
*/
const px = (width: string | undefined) => {
  const m = /^(\d+)px$/.exec(width ?? "");
  if (!m) throw new Error(`nem px szélesség: ${width}`);
  return Number(m[1]);
};

describe("az akvárium-lista oszlopai", () => {
  it("a fejlécek a régiek, így a telefonos kártya felirata is", () => {
    expect(AQUARIUM_COLUMNS.map((c) => c.header)).toEqual([
      "Név",
      "Tulajdon",
      "Ügyfél",
      "Típus",
      "Víz",
      "Liter",
      "Berendezések",
      "Karbantartók",
      "Utolsó vízmérés",
    ]);
  });

  it("az oszlopok összege belefér a tábla minimumába", () => {
    const sum = AQUARIUM_COLUMNS.reduce((acc, c) => acc + px(c.width), 0);
    expect(sum).toBeLessThanOrEqual(AQUARIUM_TABLE_MIN_WIDTH);
  });

  it("a Liter jobbra zárt és egy sorban marad, az Utolsó vízmérés is", () => {
    const by = (header: string) =>
      AQUARIUM_COLUMNS.find((c) => c.header === header)!;
    expect(by("Liter").align).toBe("right");
    expect(by("Liter").nowrap).toBe(true);
    expect(by("Utolsó vízmérés").nowrap).toBe(true);
  });
});
