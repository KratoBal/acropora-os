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

/** Kommentek nelkul: a blokk-komment csak sor elejen, szokozt vagy `{`/`(` utan kezdodik, igy egy
 * `accept="image/*"` alaku literal nem nyel el a fajlbol semmit. */
function stripComments(source: string): string {
  return source
    .replace(/(^|[\s{(;])\/\*[\s\S]*?\*\//gm, "$1")
    .replace(/^\s*\/\/.*$/gm, "");
}

function violates(bodies: string[]): boolean {
  const tokens = bodies.flatMap((body) => body.split(/\s+/));
  const responsive = tokens.some((t) =>
    /^(sm|md|lg|xl|2xl):grid-cols-/.test(t),
  );
  const base = tokens.some((t) => /^grid-cols-/.test(t));
  return tokens.includes("grid") && responsive && !base;
}

/** A `cn(`/`clsx(` hivas torzse: a zarojelig, a szoveg-literalokat ugorva. */
function classCalls(code: string): string[] {
  const spans: string[] = [];
  for (const start of code.matchAll(/\b(?:cn|clsx|twMerge)\(/g)) {
    let depth = 1;
    let i = start.index + start[0].length;
    const from = i;
    let quote = "";
    for (; i < code.length && depth > 0; i += 1) {
      const ch = code[i]!;
      if (quote) {
        if (ch === "\\") i += 1;
        else if (ch === quote) quote = "";
      } else if (ch === '"' || ch === "`") quote = ch;
      else if (ch === "(") depth += 1;
      else if (ch === ")") depth -= 1;
    }
    spans.push(code.slice(from, i));
  }
  return spans;
}

function bodiesOf(code: string): string[] {
  return [...code.matchAll(LITERAL)].map((m) => m[1] ?? m[2] ?? "");
}

function responsiveGridsWithoutBase(source: string): string[] {
  const code = stripComments(source);
  const found: string[] = [];
  for (const body of bodiesOf(code)) if (violates([body])) found.push(body);
  for (const span of classCalls(code)) {
    const bodies = bodiesOf(span);
    // a hivas egyetlen literalja mar fent szamolt; itt csak az OSSZEADOTT osztalylista uj talalat
    if (
      bodies.length > 1 &&
      violates(bodies) &&
      !bodies.some((b) => violates([b]))
    )
      found.push(bodies.join(" | "));
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
    // a tobb argumentumra bontott cn(): a ket literal egyutt hianyos
    expect(
      responsiveGridsWithoutBase('cn("grid gap-3", cond && "sm:grid-cols-2")'),
    ).toHaveLength(1);
    expect(
      responsiveGridsWithoutBase('cn("grid grid-cols-1", "sm:grid-cols-2")'),
    ).toHaveLength(0);
    // egy `image/*` literal nem kezd kommentet, a mogotte allo racs is latszik
    expect(
      responsiveGridsWithoutBase(
        '<input accept="image/*" />\n<div className="grid sm:grid-cols-2">{/* x */}',
      ),
    ).toHaveLength(1);
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
