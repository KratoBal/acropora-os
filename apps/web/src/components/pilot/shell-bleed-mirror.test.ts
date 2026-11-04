import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  PAGE_GUTTER_X,
  PAGE_GUTTER_Y,
  PILOT_SHELL_BLEED,
  bleedMirror,
} from "@acropora/ui";
import { describe, expect, it } from "vitest";

/*
  A KERET SZÉLÉIG ÉRŐ HÁTTÉR A HÉJ MARGÓJÁNAK TÜKRE (UI 1. csomag, barracuda #2023; T1.2 óta a margó egy konstans). A
  `PILOT_SHELL_BLEED` negatív margója pontosan az app-shell `<main>` paddingját oltja ki; ha a kettő külön mozdul, a lap
  telefonon újra kilóg (a stage-en 398 px volt 390-en, mert a -m-6 a px-4 mellett állt). MI PIROSÍT: ha a `<main>` nem a
  `PAGE_GUTTER_X` és `PAGE_GUTTER_Y` konstanssal kap margót, vagy mellé saját paddingot is kap; ha a bleed nem a
  konstansok tükre; ha a `<main>` osztálya nem olvasható ki egyértelműen.
*/
const SHELL = join(process.cwd(), "src/components/app-shell.tsx");

function mainOsztaly(): string {
  const forras = readFileSync(SHELL, "utf8");
  const mains = [...forras.matchAll(/<main\s+className=\{`([^`]+)`\}/g)];
  expect(mains).toHaveLength(1);
  return mains[0]![1]!;
}

describe("a bleed és a héj margója", () => {
  it("a <main> a közös konstansokkal kap margót, és saját paddingot nem", () => {
    const osztaly = mainOsztaly();
    expect(osztaly).toContain("${PAGE_GUTTER_X}");
    expect(osztaly).toContain("${PAGE_GUTTER_Y}");
    expect(
      osztaly
        .split(/\s+/)
        .filter((o) => /^(?:(?:sm|md|lg|xl|2xl):)?p[xy]?-/.test(o)),
    ).toEqual([]);
  });

  it("a PILOT_SHELL_BLEED minden tagja a keret egy paddingjának tükre, és egy sem hiányzik", () => {
    const padding = [...PAGE_GUTTER_X.split(" "), ...PAGE_GUTTER_Y.split(" ")];
    expect(PILOT_SHELL_BLEED.split(/\s+/).sort()).toEqual(
      padding.map(bleedMirror).sort(),
    );
  });
});
