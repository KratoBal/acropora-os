import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PILOT_SHELL_BLEED } from "@acropora/ui";
import { describe, expect, it } from "vitest";

/*
  A KERET SZÉLÉIG ÉRŐ HÁTTÉR A HÉJ MARGÓJÁNAK TÜKRE (UI 1. csomag, barracuda #2023). A `PILOT_SHELL_BLEED` negatív
  margója pontosan az app-shell `<main>` paddingját oltja ki; ha a kettő külön mozdul, a lap telefonon újra kilóg
  (a stage-en 398 px volt 390-en, mert a -m-6 a px-4 mellett állt). MI PIROSÍT: ha a `<main>` paddingja változik, és
  a bleed nem követi (vagy fordítva); ha a `<main>` osztálya nem olvasható ki egyértelműen.
*/
const SHELL = join(process.cwd(), "src/components/app-shell.tsx");

function mainPadding(): string[] {
  const forras = readFileSync(SHELL, "utf8");
  const mains = [...forras.matchAll(/<main\s+className="([^"]+)"/g)];
  expect(mains).toHaveLength(1);
  return mains[0]![1]!
    .split(/\s+/)
    .filter((osztaly) => /^(?:(?:sm|md|lg|xl|2xl):)?p[xy]-/.test(osztaly));
}

function tukor(osztaly: string): string {
  const [, elotag = "", tengely, ertek] = osztaly.match(
    /^((?:sm|md|lg|xl|2xl):)?p([xy])-(.+)$/,
  )!;
  return `${elotag}-m${tengely}-${ertek}`;
}

describe("a bleed és a héj margója", () => {
  it("a PILOT_SHELL_BLEED minden tagja a <main> egy paddingjának tükre, és egy sem hiányzik", () => {
    const padding = mainPadding();
    expect(padding.length).toBeGreaterThan(0);
    expect(PILOT_SHELL_BLEED.split(/\s+/).sort()).toEqual(
      padding.map(tukor).sort(),
    );
  });
});
