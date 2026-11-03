import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/*
  TELEFONON 16 PX-ES LAPMARGÓ A KERET SZÉLÉIG ÉRŐ LAPOKON IS (UI 1. kör, 2026-11-03, murena a stage-képek után): a
  `bleed` lapok (PilotThemeRoot bleed) a héj paddingját kioltják, és saját margót adnak; ahol ez sima `px-8` volt, telefonon
  32 px maradt, a többi lapon 16. MI PIROSÍT: ha egy bleed lapon egy osztály `px-8`-at vagy `mx-8`-at ad kisebb alap nélkül
  (a helyes alak `px-4 sm:px-8`). A megjegyzéseket kivágjuk.
*/
const ROOT = join(process.cwd(), "src");

function fajlok(mappa: string): string[] {
  return readdirSync(mappa).flatMap((nev) => {
    const ut = join(mappa, nev);
    if (statSync(ut).isDirectory()) return fajlok(ut);
    return /\.tsx$/.test(nev) && !/\.test\./.test(nev) ? [ut] : [];
  });
}

function kod(forras: string): string {
  return forras
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}

const BLEED = /<PilotThemeRoot\b[^>]*\bbleed\b/;
const OSZTALY = /className=(?:"([^"]*)"|\{`([^`]*)`\})/g;

/** Egy osztálysor telefonon is 32 px-es margót ad: `px-8` vagy `mx-8` van benne előtag nélkül, és nincs mellette kisebb alap. */
function telefononSzeles(osztaly: string): boolean {
  return (["px", "mx"] as const).some(
    (fajta) =>
      new RegExp(`(?<![\\w:-])${fajta}-8(?![\\w-])`).test(osztaly) &&
      !new RegExp(`(?<![\\w:-])${fajta}-[0-7](?![\\w-])`).test(osztaly),
  );
}

const talalatok = () =>
  fajlok(ROOT).flatMap((ut) => {
    const forras = kod(readFileSync(ut, "utf8"));
    if (!BLEED.test(forras)) return [];
    return [...forras.matchAll(OSZTALY)]
      .map((m) => m[1] ?? m[2] ?? "")
      .filter(telefononSzeles)
      .map((osztaly) => `${relative(ROOT, ut)}: ${osztaly}`);
  });

describe("telefonon széles lapmargó a bleed lapokon", () => {
  it("a mérő felismeri a telefonon is széles margót (önteszt)", () => {
    expect(telefononSzeles("flex-1 px-8 py-6")).toBe(true);
    expect(telefononSzeles("mx-8 mb-5")).toBe(true);
    expect(telefononSzeles("flex-1 px-4 py-6 sm:px-8")).toBe(false);
    expect(telefononSzeles("mx-4 mb-5 sm:mx-8")).toBe(false);
    expect(telefononSzeles("px-3 py-2")).toBe(false);
    expect(telefononSzeles("lg:px-8")).toBe(false);
  });

  it("a mérő bleed lapokat talál (pozitív kontroll)", () => {
    const bleed = fajlok(ROOT).filter((ut) =>
      BLEED.test(kod(readFileSync(ut, "utf8"))),
    );
    expect(bleed.length).toBeGreaterThan(15);
  });

  it("egy bleed lapon sincs kisebb alap nélküli px-8 vagy mx-8", () => {
    expect(talalatok()).toEqual([]);
  });
});
