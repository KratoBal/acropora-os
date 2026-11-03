import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * EGY BETŰTÍPUS AZ OS-BEN: INTER (UI-áttekintés, 2026-11-03).
 *
 * A közös `theme.css` a `--font-dm-sans` és `--font-manrope` változókra
 * hivatkozik, a partner és a reefclub ott tölti be a sajátját. A webes app nem
 * tölt be sem DM Sanst, sem Manrope-ot, hanem a `web-font.css` mindkét változót
 * az Inter változójára irányítja. A mérés a KÓDRA megy (kommentek nélkül).
 */
const WEB = process.cwd();
const read = (p: string) => readFileSync(p, "utf8");
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Az Inter-útvonal törése: a `--font-dm-sans`/`--font-manrope` valaki mástól jön. */
function loadsOwnFont(layoutSource: string): boolean {
  return /localFont\s*\(|next\/font\/google|--font-(dm-sans|manrope)/.test(
    stripComments(layoutSource),
  );
}

function routesBothToInter(css: string): boolean {
  const code = stripComments(css);
  return (
    /--font-dm-sans:\s*var\(--font-pilot-inter\)/.test(code) &&
    /--font-manrope:\s*var\(--font-pilot-inter\)/.test(code)
  );
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

describe("a webes app betűtípusa Inter", () => {
  const layout = read(join(WEB, "src", "app", "layout.tsx"));
  const webFont = read(join(WEB, "src", "app", "web-font.css"));
  const pilotFont = read(
    join(WEB, "src", "components", "pilot", "pilot-font.ts"),
  );

  it("a mérő felismeri a saját betűtípust és a hiányzó átirányítást (önteszt)", () => {
    expect(
      loadsOwnFont('const a = localFont({ variable: "--font-dm-sans" });'),
    ).toBe(true);
    expect(loadsOwnFont("// localFont( régi\nexport const x = 1;")).toBe(false);
    expect(
      routesBothToInter(":root { --font-dm-sans: var(--font-pilot-inter); }"),
    ).toBe(false);
    expect(
      routesBothToInter(
        ":root { --font-dm-sans: var(--font-pilot-inter); --font-manrope: var(--font-pilot-inter); }",
      ),
    ).toBe(true);
  });

  it("a gyökér layout nem tölt be DM Sanst vagy Manrope-ot, az Inter változója a html-en áll", () => {
    expect(loadsOwnFont(layout)).toBe(false);
    expect(stripComments(layout)).toMatch(
      /<html[^>]*className=\{pilotInter\.variable\}/,
    );
    expect(stripComments(layout)).toContain('import "./web-font.css"');
  });

  it("a web-font.css mindkét közös változót az Interre irányítja", () => {
    expect(routesBothToInter(webFont)).toBe(true);
    expect(stripComments(webFont)).toMatch(/:root\s*\{/);
  });

  it("az Inter változója a pilot-font példányból jön", () => {
    expect(stripComments(pilotFont)).toContain(
      'variable: "--font-pilot-inter"',
    );
  });

  it("a webes appban nem maradt DM Sans vagy Manrope betűfájl", () => {
    const left = walk(join(WEB, "src")).filter((p) =>
      /(dm-sans|manrope)[^/]*\.(woff2?|ttf|otf)$/i.test(p),
    );
    expect(left).toEqual([]);
  });

  it("a közös téma alapértéke a partnernek változatlan (a változókra hivatkozik)", () => {
    const theme = stripComments(
      read(join(WEB, "..", "..", "packages", "ui", "src", "theme.css")),
    );
    expect(theme).toContain("var(--font-dm-sans)");
    expect(theme).toContain("var(--font-manrope)");
  });
});
