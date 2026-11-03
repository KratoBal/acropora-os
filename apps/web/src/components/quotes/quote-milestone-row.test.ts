import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A FIZETESI MERFOLDKO SORA TELEFONON EGY SOR (UI-attekintes, stage-foto 2026-11-03, 390 px: a
 * nev- es a szazalekmezo is `w-full` volt `flex-wrap` sorban, igy a nev, a szazalek, a "%" es a
 * torles gomb kulon sorba esett). A mero a KODRA megy: a sor nem tordelheto, a nev kapja a
 * maradekot, a szazalek rogzitett szelessegu. Harom helyen van ilyen sor.
 */
const DIR = join(process.cwd(), "src", "components", "quotes");
const FILES = [
  "quote-editor-page.tsx",
  "quote-template-editor-page.tsx",
  "quote-snippets-page.tsx",
];

const stripComments = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

/** A sor kodja: a `mérföldkő neve` mezo elotti sor-nyito div-tol a torlesig. */
function milestoneRows(source: string): string[] {
  const code = stripComments(source);
  const rows: string[] = [];
  for (const m of code.matchAll(
    /\{[^\n]*\.map\(\([^)]*index\)\s*=>\s*\(\s*<div[^>]*>/g,
  )) {
    const from = m.index;
    const to = code.indexOf("mérföldkő törlése", from);
    if (to === -1) continue;
    const row = code.slice(from, to);
    if (row.includes("mérföldkő neve")) rows.push(row);
  }
  return rows;
}

function rowProblems(row: string): string[] {
  const problems: string[] = [];
  const opening = /<div[^>]*className="([^"]*)"/.exec(row)?.[1] ?? "";
  if (/\bflex-wrap\b/.test(opening))
    problems.push("a sor tordelheto (flex-wrap)");
  if (!/\bflex\b/.test(opening)) problems.push("a sor nem flex");
  if (!/min-w-0 flex-1/.test(row)) problems.push("a nev nem kapja a maradekot");
  if (!/w-20 shrink-0/.test(row))
    problems.push("a szazalek nem rogzitett szelessegu");
  return problems;
}

describe("a fizetési mérföldkő sora telefonon egy sor", () => {
  it("a mérő felismeri a törhető sort és a hiányzó méreteket (önteszt)", () => {
    const bad = `{rows.map((row, index) => (
      <div key={index} className="flex flex-wrap items-center gap-2">
        <PilotInput aria-label={\`\${index + 1}. mérföldkő neve\`} />
        <PilotInput aria-label={\`\${index + 1}. mérföldkő százaléka\`} />
        <PilotButton aria-label={\`\${index + 1}. mérföldkő törlése\`} />`;
    const found = milestoneRows(bad);
    expect(found).toHaveLength(1);
    expect(rowProblems(found[0]!)).toEqual([
      "a sor tordelheto (flex-wrap)",
      "a nev nem kapja a maradekot",
      "a szazalek nem rogzitett szelessegu",
    ]);
  });

  for (const file of FILES) {
    it(`${file}: minden mérföldkő-sor egy sor`, () => {
      const rows = milestoneRows(readFileSync(join(DIR, file), "utf8"));
      expect(rows).toHaveLength(1);
      expect(rowProblems(rows[0]!)).toEqual([]);
    });
  }
});
