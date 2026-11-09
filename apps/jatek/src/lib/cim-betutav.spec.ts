import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/*
  WHAT TURNS THIS RED (Balázs, 2026-11-06 19:48 UTC: "2.2. A nyertesek további adatai" read as "2.2.Anyertesektovábbiadatai"):
  a SMALL heading (25 px or less) inheriting the global `h1, h2, h3 { letter-spacing: -1.4px }`, which is made for the 65 px
  display title and, on a 16 px line, is about 9% of the size: the letters touch and the space closes. Every rule that gives
  an h1, h2 or h3 a font size of 25 px or less must have an explicit letter-spacing (in that rule or in the same selector's
  other rule), and none may be tighter than -0.7px.
*/
const CSS = ["jatek.css", "fodij.css"]
  .map((f) => readFileSync(join(process.cwd(), "src", "app", f), "utf8"))
  .join("\n");

type Rule = { selector: string; body: string };

/** The innermost `{ }` blocks (a media query's wrapper holds braces, so only its rules match). */
function rules(css: string): Rule[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: m[1]!.trim().replace(/\s+/g, " "),
    body: m[2]!,
  }));
}

const headingSelectors = (selector: string) =>
  selector
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /(^|[\s>+~])h[123]$/.test(s));

const px = (body: string, property: string): number | null => {
  const m = new RegExp(
    `(?:^|[;\\s])${property}:\\s*(-?[\\d.]+)(px)?\\s*(?:;|$)`,
  ).exec(body);
  return m ? Number(m[1]) : null;
};

describe("a kis címek betűköze", () => {
  const all = rules(CSS);

  it("a mérő megtalálja a szabályokat és a kis címeket (pozitív kontroll)", () => {
    assert.ok(all.length > 300);
    const small = all.filter(
      (r) =>
        headingSelectors(r.selector).length > 0 &&
        (px(r.body, "font-size") ?? 99) <= 25,
    );
    assert.ok(small.length >= 8, `${small.length} small heading rules`);
    // the rule that broke on the legal pages is among them
    assert.ok(small.some((r) => r.selector === ".jatek-jogi h3"));
  });

  it("minden 25 px-es vagy kisebb h1-h3 szabályhoz van kimondott betűköz, és egyik sem szorosabb -0.7px-nél", () => {
    const spacings = new Map<string, number[]>();
    for (const r of all) {
      const ls = px(r.body, "letter-spacing");
      if (ls === null) continue;
      for (const s of headingSelectors(r.selector))
        spacings.set(s, [...(spacings.get(s) ?? []), ls]);
    }
    const bad: string[] = [];
    for (const r of all) {
      const size = px(r.body, "font-size");
      if (size === null || size > 25) continue;
      for (const s of headingSelectors(r.selector)) {
        // a heading inside the prize page takes the `.fodij h1, .fodij h2, .fodij h3` rule's spacing
        const level = /h[123]$/.exec(s)![0];
        const own =
          spacings.get(s) ??
          (s.startsWith(".fodij")
            ? spacings.get(`.fodij ${level}`)
            : undefined);
        if (!own || own.length === 0)
          bad.push(`${s} (${size}px): nincs betűköz`);
        else if (Math.min(...own) < -0.7)
          bad.push(`${s} (${size}px): ${Math.min(...own)}px túl szoros`);
      }
    }
    assert.deepEqual(bad, []);
  });
});
