import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/*
  A LAPMARGÓ EGY KERETBŐL (T1.2, kártya 9314b045). A keret és a keret széléig érő lapok sávjai a `PAGE_GUTTER_X`,
  `PAGE_GUTTER_MX` és `PAGE_GUTTER_Y` konstanst használják (`@acropora/ui`, `page-frame.ts`). Kézzel írva 53 helyen állt
  `px-4 sm:px-8`, sm és lg között a keret 24 px-e helyett 32-vel, és 2026-11-03-án két PR javította a rossz másolatait
  (#2084, #2087). MI PIROSÍT: ha egy szövegben a telefonos 16 px-es alap (`px-4`, `mx-4`, `-mx-4`) töréspontos
  vízszintes párjával együtt áll, vagyis valaki a lapmargót kézzel írta le. Kivétel nincs. A megjegyzéseket kivágjuk.
*/
const ROOT = join(process.cwd(), "src");

function fajlok(mappa: string): string[] {
  return readdirSync(mappa).flatMap((nev) => {
    const ut = join(mappa, nev);
    if (statSync(ut).isDirectory()) return fajlok(ut);
    return /\.tsx?$/.test(nev) && !/\.test\./.test(nev) ? [ut] : [];
  });
}

/** Blokk-komment csak sor elején vagy szóköz, `{`, `(`, `;` után kezdődik (a `grid-base-track.test.ts` mintája), így
 * egy `"src/**\/*.ts"` alakú szöveg nem nyeli el a fájlt a következő `*\/`-ig (barracuda, #2121). */
function kod(forras: string): string {
  return forras
    .replace(/(^|[\s{(;])\/\*[\s\S]*?\*\//gm, "$1 ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}

const SZOVEG = /"([^"\n]*)"|`([^`]*)`/g;

/**
 * Egy osztálysor kézzel írt lapmargó: a 16 px-es alap és egy töréspontos vízszintes pár ugyanabban a sorban; VAGY a
 * közös konstans mellett egy töréspontos felülírás ugyanazon a tengelyen (`${PAGE_GUTTER_X} sm:px-8`: a konstans
 * ott van, a hiba mégis visszajön; barracuda, #2121).
 */
function kezziLapmargo(osztaly: string): boolean {
  const tokenek = osztaly.split(/\s+/);
  const toresponti = (fajta: string) =>
    tokenek.some((t) =>
      new RegExp(`^(?:sm|md|lg|xl|2xl):${fajta}-\\S+$`).test(t),
    );
  return (
    (["px", "mx", "-mx"] as const).some(
      (fajta) => tokenek.includes(`${fajta}-4`) && toresponti(fajta),
    ) ||
    (osztaly.includes("${PAGE_GUTTER_X}") && toresponti("px")) ||
    (osztaly.includes("${PAGE_GUTTER_MX}") && toresponti("mx"))
  );
}

const talalatok = () =>
  fajlok(ROOT).flatMap((ut) =>
    [...kod(readFileSync(ut, "utf8")).matchAll(SZOVEG)]
      .map((m) => m[1] ?? m[2] ?? "")
      .filter(kezziLapmargo)
      .map((osztaly) => `${relative(ROOT, ut)}: ${osztaly.trim()}`),
  );

describe("kézzel írt lapmargó", () => {
  it("a mérő felismeri a kézzel írt lapmargót (önteszt)", () => {
    expect(kezziLapmargo("px-4 sm:px-8 pt-6")).toBe(true);
    expect(kezziLapmargo("flex px-4 py-6 sm:px-6 lg:px-8")).toBe(true);
    expect(kezziLapmargo("mx-4 mb-5 sm:mx-8")).toBe(true);
    expect(kezziLapmargo("-mx-4 -my-6 sm:-mx-6")).toBe(true);
    expect(kezziLapmargo("pb-5 pt-6 bg-white")).toBe(false);
    expect(kezziLapmargo("px-2 py-3 sm:px-3")).toBe(false);
    expect(kezziLapmargo("px-4 py-2")).toBe(false);
    expect(kezziLapmargo("lg:px-8")).toBe(false);
    expect(kezziLapmargo("$" + "{PAGE_GUTTER_X} pt-6 sm:px-8")).toBe(true);
    expect(kezziLapmargo("$" + "{PAGE_GUTTER_MX} lg:mx-10")).toBe(true);
    expect(kezziLapmargo("$" + "{PAGE_GUTTER_X} pt-6 sm:py-8")).toBe(false);
    expect(
      kod('const glob = "src/**/*.ts";\nconst c = "px-4 sm:px-8";'),
    ).toContain("px-4 sm:px-8");
  });

  it("a mérő látja a konstanst használó sávokat (pozitív kontroll)", () => {
    const hasznalat = fajlok(ROOT).filter((ut) =>
      /\$\{PAGE_GUTTER_X\}/.test(readFileSync(ut, "utf8")),
    );
    expect(hasznalat.length).toBeGreaterThan(20);
  });

  it("egy lap sem írja kézzel a lapmargót", () => {
    expect(
      talalatok(),
      "A lapmargó a PAGE_GUTTER_X / PAGE_GUTTER_MX konstansból jön (@acropora/ui, page-frame.ts). Ha a talált sor NEM " +
        "lapmargó, hanem egy elem belső paddingja (párbeszédablak, kártya-lábléc), ne 16 px-es alappal írd (px-5, px-3), " +
        "vagy ha az a helyes érték, emeld ki egy nevesített konstansba, és a sort írd le ebben a tesztben indokkal.",
    ).toEqual([]);
  });
});
