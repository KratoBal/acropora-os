import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/*
  EGY ELSŐDLEGES GOMBSZÍN AZ OS-BEN (UI-áttekintés, 2026-11-03; acrobot: a navy, a narancs és a barack elsődleges
  gombok ki, egy teal marad). A közös `Button` elsődlegese a `--color-action*` tokeneken át színez: a `theme.css`
  alapértéke a régi (dusk) szín, hogy az `apps/partner` ne változzon; az `apps/web` a `globals.css`-ben a Pilot teal-jára írja át.
  MI PIROSÍT: ha a `Button` elsődlegese újra közvetlen dusk színt kap; ha a web felülírása nem egyezik a Pilot teal
  `aqua-600/700/500` értékével; ha a partner alapértéke elmozdul; ha egy komponensben újra narancs (`pilot-accent-warm`) háttérű,
  fehér szövegű gomb áll a kivételek listáján kívül (a számláló-jelvények nem gombok).
*/
const WEB = process.cwd();
const UI = join(WEB, "..", "..", "packages", "ui", "src");
const read = (p: string) => readFileSync(p, "utf8");

/** A `--color-<név>: #xxxxxx;` első előfordulása egy CSS-fájlban. */
function token(css: string, name: string): string | null {
  return (
    new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css)?.[1] ?? null
  );
}

/**
 * Igaz, ha a (kommentek nélküli) CSS-ben stílusszabály után még `@import` áll:
 * a böngésző az ilyet eldobja. Az `@import`, `@source` és `@charset` sorok nem szabályok.
 */
function importAfterRule(css: string): boolean {
  const lines = css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  let sawRule = false;
  for (const line of lines) {
    if (/^@(import|source|charset)\b/.test(line)) {
      if (line.startsWith("@import") && sawRule) return true;
      continue;
    }
    sawRule = true;
  }
  return false;
}

describe("az elsődleges gomb színe", () => {
  const theme = read(join(UI, "theme.css"));
  const figma = read(join(UI, "figma-theme.css"));
  const globals = read(join(WEB, "src", "app", "globals.css"));
  const button = read(join(UI, "button.tsx"));

  it("a Button elsődlegese a tokenen át színez, nem közvetlen dusk színnel", () => {
    expect(button).toMatch(/primary:\s*"bg-action\b[^"]*hover:bg-action-hover/);
    expect(button).not.toMatch(/primary:\s*"[^"]*dusk-/);
    expect(button).toContain("focus-visible:ring-action-ring");
  });

  it("a web felülírása a Pilot teal értékei", () => {
    expect(token(globals, "action")).toBe(token(figma, "pilot-aqua-600"));
    expect(token(globals, "action-hover")).toBe(token(figma, "pilot-aqua-700"));
    expect(token(globals, "action-ring")).toBe(token(figma, "pilot-aqua-500"));
    expect(token(globals, "action")).not.toBeNull();
  });

  it("a web felülírása után nem áll @import (önteszt + valódi fájl)", () => {
    expect(
      importAfterRule('@import "a";\n:root { --x: 1; }\n@import "b";'),
    ).toBe(true);
    expect(
      importAfterRule('@import "a";\n@import "b";\n:root { --x: 1; }'),
    ).toBe(false);
    expect(importAfterRule(globals)).toBe(false);
  });

  it("a partner alapértéke (theme.css) a régi dusk szín marad", () => {
    expect(token(theme, "action")).toBe(token(theme, "dusk-900"));
    expect(token(theme, "action-hover")).toBe(token(theme, "dusk-800"));
    expect(token(theme, "action-ring")).toBe(token(theme, "brand-500"));
    expect(token(theme, "action")).not.toBeNull();
  });
});

const ROOT = join(WEB, "src", "components");
// Nem gombok: a számláló-jelvények (olvasatlan üzenetek száma).
const KIVETELEK = new Map<string, string>([
  ["messages/conversation-parts.tsx", "olvasatlan-számláló jelvény, nem gomb"],
  ["shell-profile.tsx", "olvasatlan-számláló jelvény, nem gomb"],
]);

function fajlok(mappa: string): string[] {
  return readdirSync(mappa).flatMap((nev) => {
    const ut = join(mappa, nev);
    if (statSync(ut).isDirectory()) return fajlok(ut);
    return /\.tsx$/.test(nev) && !/\.test\./.test(nev) ? [ut] : [];
  });
}

const NARANCS_GOMB = /bg-pilot-accent-warm\b(?!-)[^"`]*\btext-white\b/;

describe("narancs elsődleges gomb a komponensekben", () => {
  it("a mérő felismeri a narancs gombot (önteszt)", () => {
    expect(
      NARANCS_GOMB.test('className="h-9 bg-pilot-accent-warm px-5 text-white"'),
    ).toBe(true);
    expect(
      NARANCS_GOMB.test('className="bg-pilot-accent-warm-soft p-3 text-grey"'),
    ).toBe(false);
  });

  it("nincs narancs háttérű, fehér szövegű elem a kivételek listáján kívül", () => {
    const talalat = fajlok(ROOT)
      .filter((ut) => NARANCS_GOMB.test(read(ut)))
      .map((ut) => relative(ROOT, ut).replaceAll("\\", "/"))
      .filter((ut) => !KIVETELEK.has(ut));
    expect(talalat).toEqual([]);
  });

  it("minden kivétel még létezik és még ilyen elemet tartalmaz (nem avult a lista)", () => {
    for (const [ut, ok] of KIVETELEK) {
      expect(NARANCS_GOMB.test(read(join(ROOT, ut))), `${ut}: ${ok}`).toBe(
        true,
      );
    }
  });
});
