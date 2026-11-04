import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A RUGALMAS RÁCS-SÁV ZSUGORODHAT (T1.2, 2. szelet, kártya 9314b045). Egy
 * tetszőleges sablonú rácsban (`lg:grid-cols-[1fr_368px]`) a csupasz `1fr` a
 * CSS-ben `minmax(auto, 1fr)`: a sáv nem mehet a tartalma legkisebb szélessége
 * alá, tehát egy hosszú cikkszám, egy táblázat vagy egy nem törő gombsor
 * kitolja a lapot a képernyőből. A `minmax(0,1fr)` zsugorodik, és a tartalom
 * törik vagy a saját görgetőjében marad. Ugyanez a hibacsalád, amit a
 * `grid-base-track.test.ts` az alap sávra fog (#2082); ez a sablonon belüli
 * sávokra.
 *
 * MI PIROSÍT: ha egy szöveg-literálban (az `apps/web/src` és a `packages/ui/src`
 * forrásában) tetszőleges `grid-cols-[...]` sablon csupasz `Nfr` sávot tartalmaz.
 * Kivétel nincs: a 2026-11-04-i 17 helyet ez a PR mind átírta.
 */
const ROOTS = [
  join(process.cwd(), "src"),
  join(process.cwd(), "../../packages/ui/src"),
];
const LITERAL = /"([^"\n]*)"|`([^`]*)`/g;
const TEMPLATE = /(?:^|\s)(?:(?:sm|md|lg|xl|2xl):)?grid-cols-\[([^\]\s]+)\]/g;

/** Mint a `grid-base-track.test.ts`-ben: blokk-komment csak sor elején vagy szóköz, `{`, `(`, `;` után kezdődik, így
 * egy `"src/**\/*.ts"` alakú szöveg nem nyel el a fájlból semmit (barracuda, #2121). */
function stripComments(source: string): string {
  return source
    .replace(/(^|[\s{(;])\/\*[\s\S]*?\*\//gm, "$1")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** A sablon csupasz `fr` sávjai (`1fr`, `1.5fr`); a zárójelen belüli aláhúzás nem sávhatár. */
function bareFrTracks(template: string): string[] {
  return template
    .split(/_(?![^(]*\))/)
    .filter((track) => /^\d*\.?\d*fr$/.test(track));
}

function templatesOf(source: string): string[] {
  const out: string[] = [];
  for (const m of stripComments(source).matchAll(LITERAL))
    for (const t of (m[1] ?? m[2] ?? "").matchAll(TEMPLATE)) out.push(t[1]!);
  return out;
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx?$/.test(name) && !/\.(test|spec)\./.test(name) ? [path] : [];
  });
}

const all = () =>
  ROOTS.flatMap((root) =>
    files(root).flatMap((path) =>
      templatesOf(readFileSync(path, "utf8")).map((template) => ({
        where: relative(process.cwd(), path),
        template,
      })),
    ),
  );

describe("rugalmas rács-sáv", () => {
  it("a mérő felismeri a csupasz fr sávot (önteszt)", () => {
    expect(bareFrTracks("1fr_368px")).toEqual(["1fr"]);
    expect(bareFrTracks("1.5fr_minmax(0,1fr)")).toEqual(["1.5fr"]);
    expect(bareFrTracks("minmax(0,1fr)_368px")).toEqual([]);
    expect(bareFrTracks("repeat(4,minmax(0,1fr))_minmax(0,1.2fr)")).toEqual([]);
    expect(
      templatesOf(
        '<div className="grid grid-cols-1 lg:grid-cols-[1fr_320px]">',
      ),
    ).toEqual(["1fr_320px"]);
    expect(
      templatesOf(
        'const a = "src/**/*.ts"; const b = "lg:grid-cols-[1fr_auto]";',
      ),
    ).toEqual(["1fr_auto"]);
  });

  it("a mérő tetszőleges sablonokat talál (pozitív kontroll)", () => {
    expect(all().length).toBeGreaterThan(20);
  });

  it("egy sablonban sincs csupasz fr sáv", () => {
    expect(
      all()
        .filter(({ template }) => bareFrTracks(template).length)
        .map(({ where, template }) => `${where}: ${template}`),
    ).toEqual([]);
  });
});
