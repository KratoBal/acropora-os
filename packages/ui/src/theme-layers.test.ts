import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * A KOZOS TEMA NEM ADHAT RETEG NELKULI BETU-SZABALYT A FORM-ELEMEKNEK.
 *
 * A Tailwind v4 osztalyai az `utilities` retegben elnek, es egy reteg
 * (`@layer`) nelkuli szabaly minden reteget legyoz, a specificitastol
 * fuggetlenul. Egy reteg nelkuli `button { font: inherit }` ezert a gombok
 * minden `font-*`, `text-*` es `leading-*` osztalyat csendben kioltja
 * (2026-11-02, a #2005 stage-merese: `font-bold` -> 400). A preflight az
 * oroklest a `base` retegben mar megadja, tehat itt erre nincs szukseg.
 *
 * A FORRAS SZOVEGET olvassuk (ehhez a csomaghoz nincs CSS-forditas a
 * tesztben): a megjegyzesek kivagasa utan a legfelso szintu blokkokat
 * jarjuk be, es a `@layer` blokkok belsejet atugorjuk -- az ott allo
 * szabaly a retegsorrend szerint feluliirhato, tehat nem hiba.
 */
const THEME = join(process.cwd(), "src", "theme.css");

const FORM_ELEMENT =
  /(^|[\s,>+~(])(button|input|select|textarea|optgroup)(?![\w-])/;
const FONT_PROPERTY = /(^|[;{\s])(font(-[a-z-]+)?|line-height)\s*:/;

/** Top-level `selector { body }` blocks outside any at-rule, comments removed. */
export function unlayeredRules(
  css: string,
): { selector: string; body: string }[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: { selector: string; body: string }[] = [];
  let depth = 0;
  let start = 0;
  let header = "";
  let bodyStart = 0;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") {
      if (depth === 0) {
        header = src.slice(start, i).trim();
        bodyStart = i + 1;
      }
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        if (!header.startsWith("@"))
          out.push({ selector: header, body: src.slice(bodyStart, i) });
        start = i + 1;
      }
    } else if (ch === ";" && depth === 0) {
      start = i + 1; // top-level statements such as @import
    }
  }
  return out;
}

export function unlayeredFormFontRules(css: string): string[] {
  return unlayeredRules(css)
    .filter((r) => FORM_ELEMENT.test(r.selector) && FONT_PROPERTY.test(r.body))
    .map((r) => r.selector.replace(/\s+/g, " "));
}

describe("a közös theme.css form-elemei", () => {
  it("nem kapnak réteg nélküli betű-szabályt (a Tailwind osztályaik érvényesülnek)", () => {
    assert.deepEqual(unlayeredFormFontRules(readFileSync(THEME, "utf8")), []);
  });

  it("a mérő megfogja a réteg nélküli alakot, és átengedi a rétegben állót", () => {
    assert.deepEqual(
      unlayeredFormFontRules("button,\ninput {\n  font: inherit;\n}"),
      ["button, input"],
    );
    assert.deepEqual(
      unlayeredFormFontRules(".x > button { font-weight: 700 }"),
      [".x > button"],
    );
    assert.deepEqual(
      unlayeredFormFontRules(
        "@layer base { button, input { font: inherit; } }",
      ),
      [],
    );
    assert.deepEqual(
      unlayeredFormFontRules(
        "/* button { font: inherit } */ ::selection { color: red }",
      ),
      [],
    );
    assert.deepEqual(
      unlayeredFormFontRules(".button-like { font-weight: 700 }"),
      [],
    );
    assert.deepEqual(unlayeredFormFontRules("button { background: red }"), []);
  });
});
