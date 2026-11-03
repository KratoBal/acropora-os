import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * MINDEN RESZPONZIV RACSNAK VAN ALAP SAVJA (acrobot merese, 2026-11-03: az
 * /akvariumok/uj 422 px szeles volt 390 helyett).
 *
 * Egy `grid` osztalyu elem `sm:grid-cols-N` (vagy md/lg/xl) osztallyal, de alap
 * `grid-cols-*` nelkul telefonon EGYETLEN `auto` savot kap, es egy auto savot a
 * gyerekek legszukebb tartalma nyujt szet (egy `<select>` a leghosszabb opciojaig).
 * A `grid-cols-1` Tailwind 4-ben `repeat(1, minmax(0, 1fr))`: meghatarozott,
 * zsugorodo sav. A mero a KODRA megy (a tsx-ben allo szoveg-literalokra, kommentek
 * nelkul).
 */
const SRC = join(process.cwd(), "src");
const LITERAL = /"([^"\n]*)"|`([^`]*)`/g;

function responsiveGridsWithoutBase(source: string): string[] {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const found: string[] = [];
  for (const match of code.matchAll(LITERAL)) {
    const body = match[1] ?? match[2] ?? "";
    const tokens = body.split(/\s+/);
    if (!tokens.includes("grid")) continue;
    const responsive = tokens.some((t) =>
      /^(sm|md|lg|xl|2xl):grid-cols-/.test(t),
    );
    const base = tokens.some((t) => /^grid-cols-/.test(t));
    if (responsive && !base) found.push(body);
  }
  return found;
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (path.endsWith(".tsx") && !path.includes(".test.")) out.push(path);
  }
  return out;
}

describe("a reszponziv racsoknak telefonon meghatarozott savjuk van", () => {
  it("a mero felismeri a hianyzo alap savot (onteszt)", () => {
    expect(
      responsiveGridsWithoutBase('<div className="grid gap-3 sm:grid-cols-2">'),
    ).toHaveLength(1);
    expect(
      responsiveGridsWithoutBase(
        '<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">',
      ),
    ).toHaveLength(0);
    expect(
      responsiveGridsWithoutBase("cn(`grid gap-2 ${x} md:grid-cols-3`)"),
    ).toHaveLength(1);
    expect(
      responsiveGridsWithoutBase('// "grid sm:grid-cols-2" regi\nconst a = 1;'),
    ).toHaveLength(0);
  });

  it("a webes app egyetlen szoveg-literaljaban sincs alap sav nelkuli reszponziv racs", () => {
    const offenders = sourceFiles(SRC).flatMap((file) =>
      responsiveGridsWithoutBase(readFileSync(file, "utf8")).map(
        (body) => `${file.slice(SRC.length + 1)}: ${body}`,
      ),
    );
    expect(offenders).toEqual([]);
  });
});
