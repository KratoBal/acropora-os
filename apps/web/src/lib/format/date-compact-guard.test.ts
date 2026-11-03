import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { formatQuoteDay } from "@/components/quotes/quote-format";

import { formatDayHu } from "./date";

/*
  EGY DÁTUMALAK A LISTÁKBAN (UI-áttekintés, 4. csomag, 2026-11-03). Az ajánlatlista és az ajánlat adatlap
  "2026.11.07."-et írt (szóközök nélkül), minden más lista "2026. 11. 07."-et. Az őrző a forrásban keresi a
  szóköz nélküli, pontokkal összefűzött dátum-sablont (`${év}.${hó}.${nap}.`). MI PIROSÍT: ha egy új formázó megint
  így fűzi össze a dátumot a kivételek listáján kívül. A kivételeknek oka van, és a lista nem avulhat el.
*/
const ROOT = join(process.cwd(), "src");

const KIVETELEK = new Map<string, string>([
  [
    "components/mortality/mortality-format.ts",
    "az elhullás-nézet a Figma szerinti tömör alakot írja (`2026.10.06.`); külön döntés kell az egységesítéséhez",
  ],
]);

function fajlok(mappa: string): string[] {
  return readdirSync(mappa).flatMap((nev) => {
    const ut = join(mappa, nev);
    if (statSync(ut).isDirectory()) return fajlok(ut);
    return /\.tsx?$/.test(nev) && !/\.test\./.test(nev) ? [ut] : [];
  });
}

function kod(forras: string): string {
  return forras
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}

const TOMOR =
  /\$\{\s*\w+(?:\.\w+)?\s*\}\.\$\{\s*\w+(?:\.\w+)?\s*\}\.\$\{\s*\w+(?:\.\w+)?\s*\}\./;

describe("a lista dátuma szóközökkel, egy alakban", () => {
  it("az ajánlat napja a közös alakot adja", () => {
    expect(formatQuoteDay("2026-11-07")).toBe("2026. 11. 07.");
    expect(formatQuoteDay("2026-11-07T10:00:00.000Z")).toBe("2026. 11. 07.");
    expect(formatQuoteDay(null)).toBe("—");
    expect(formatQuoteDay("2026-11-07")).toBe(formatDayHu("2026-11-07"));
  });

  it("a mérő felismeri a tömör sablont (önteszt)", () => {
    expect(TOMOR.test("`${y}.${m}.${d}.`")).toBe(true);
    expect(TOMOR.test("`${p.year}.${p.month}.${p.day}. ${h}`")).toBe(true);
    expect(TOMOR.test("`${m[1]}. ${m[2]}. ${m[3]}.`")).toBe(false);
  });

  it("a mérő olvasható fájlokat talál (pozitív kontroll)", () => {
    expect(fajlok(ROOT).length).toBeGreaterThan(300);
  });

  it("nincs szóköz nélküli dátum-sablon a kivételek listáján kívül", () => {
    const talalat = fajlok(ROOT)
      .filter((ut) => TOMOR.test(kod(readFileSync(ut, "utf8"))))
      .map((ut) => relative(ROOT, ut).replaceAll("\\", "/"))
      .filter((ut) => !KIVETELEK.has(ut));
    expect(talalat).toEqual([]);
  });

  it("minden kivétel még létezik és még ilyen sablont használ (nem avult a lista)", () => {
    for (const [ut, ok] of KIVETELEK) {
      const forras = readFileSync(join(ROOT, ut), "utf8");
      expect(TOMOR.test(kod(forras)), `${ut}: ${ok}`).toBe(true);
    }
  });
});
