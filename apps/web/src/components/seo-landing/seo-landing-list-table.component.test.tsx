import { describe, expect, it } from "vitest";

import {
  SEO_LANDING_COLUMNS,
  SEO_LANDING_TABLE_MIN_WIDTH,
} from "./seo-landing-list-page";

/*
  A VÁLOGATÁS-LISTA TÁBLÁJA A KÖZÖS TÁBLÁN (UI-áttekintés, 3. csomag, 2026-11-03). MI PIROSÍT: ha egy
  oszlopfejléc elvész vagy átíródik (a telefonos kártya a fejlécből veszi a feliratot); ha a rögzített
  oszlopok összege nagyobb a tábla minimumánál; ha a Frissítve dátum sorba törhet; ha a Válogatás
  (cím) oszlop rögzített szélességet kap (az az egyetlen rugalmas oszlop, ő viszi a maradékot).
*/
const px = (width: string | undefined) => {
  const m = /^(\d+)px$/.exec(width ?? "");
  if (!m) throw new Error(`nem px szélesség: ${width}`);
  return Number(m[1]);
};

describe("a válogatás-lista oszlopai", () => {
  it("a fejlécek a régiek, így a telefonos kártya felirata is", () => {
    expect(SEO_LANDING_COLUMNS.map((c) => c.header)).toEqual([
      "Válogatás",
      "Cím a webshopban",
      "Állapot",
      "Frissítve",
    ]);
  });

  it("a rögzített oszlopok összege belefér a minimumba, és a cím oszlop marad rugalmas", () => {
    const fixed = SEO_LANDING_COLUMNS.filter((c) => c.header !== "Válogatás");
    const sum = fixed.reduce((acc, c) => acc + px(c.width), 0);
    // a cím oszlopnak legalább 140 px marad
    expect(sum + 140).toBeLessThanOrEqual(SEO_LANDING_TABLE_MIN_WIDTH);
    expect(
      SEO_LANDING_COLUMNS.find((c) => c.header === "Válogatás")!.width,
    ).toBeUndefined();
  });

  it("a Frissítve dátum egy sorban marad", () => {
    expect(
      SEO_LANDING_COLUMNS.find((c) => c.header === "Frissítve")!.nowrap,
    ).toBe(true);
  });
});
