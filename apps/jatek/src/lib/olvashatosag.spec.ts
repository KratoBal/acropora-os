import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/*
  WHAT TURNS THIS RED (Balázs, 2026-11-06: "mobilon olvashatatlanul kicsi meg halvany felirat"). A font size under
  13 px anywhere (the label and the small print), also in the `font:` shorthand; the body text under 16 px; an input
  under 16 px on a phone (the iPhone zooms into it on focus); a text colour whose contrast with the lightest card
  background is under 4.5:1 (WCAG AA); the muted colour dimmed again; the dark label on the orange button losing its
  contrast. The decorative elements (the big "01", the timer's colons, the step arrows) are exempt by name: they carry
  no text. The reading of the CSS is checked too (the guard must find rules, or a green would prove nothing).
  NOT checked: the layout (the larger text can move things; that needs a browser, the screenshots do it).
*/
const APP = join(process.cwd(), "src", "app");
const KOMMENT = /\/\*[\s\S]*?\*\//g;
const css = readFileSync(join(APP, "jatek.css"), "utf8").replace(KOMMENT, "");
const tema = readFileSync(join(APP, "theme.css"), "utf8").replace(KOMMENT, "");

type Szabaly = { szelektor: string; torzs: string; mobil: boolean };

/** A legbelso szabalyok szelektorral, es hogy a `max-width: 700px` blokkban allnak-e. */
function szabalyok(forras: string): Szabaly[] {
  const kimenet: Szabaly[] = [];
  const mobilTartomany: [number, number][] = [];
  for (const m of forras.matchAll(/@media\s*\(max-width:\s*700px\)\s*\{/g)) {
    let melyseg = 1;
    let j = m.index + m[0].length;
    while (melyseg > 0 && j < forras.length) {
      if (forras[j] === "{") melyseg += 1;
      if (forras[j] === "}") melyseg -= 1;
      j += 1;
    }
    mobilTartomany.push([m.index, j]);
  }
  for (const m of forras.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const szelektor = m[1]!.replace(/@media[^{]*$/, "").trim();
    kimenet.push({
      szelektor,
      torzs: m[2]!,
      mobil: mobilTartomany.some(([a, b]) => m.index >= a && m.index < b),
    });
  }
  return kimenet;
}

const fenyero = (hex: string): number => {
  let h = hex.replace("#", "");
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  const csatorna = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * csatorna[0]! + 0.7152 * csatorna[1]! + 0.0722 * csatorna[2]!;
};
export const kontraszt = (a: string, b: string): number => {
  const [x, y] = [fenyero(a), fenyero(b)].sort((p, q) => q - p) as [
    number,
    number,
  ];
  return (x + 0.05) / (y + 0.05);
};

const KARTYA = "#11232e"; // a legvilagosabb hatter, amire szoveg kerul
const NARANCS = "#ff803e";
const DISZ = [".jatek-empty-number", ".jatek-timer i", ".jatek-steps i"];
const NARANCSON = [".jatek-button", ".jatek-skip"];
const valtozo = (nev: string): string =>
  new RegExp(`--${nev}:\\s*(#[0-9a-fA-F]{3,6})`).exec(tema)![1]!;

describe("az olvashatóság", () => {
  const mind = szabalyok(css);

  it("the reader finds the rules (a guard that finds none proves nothing)", () => {
    assert.ok(mind.length > 150, `rules: ${mind.length}`);
    assert.ok(mind.some((s) => s.mobil && s.szelektor.includes("jatek-hero")));
    assert.ok(mind.some((s) => !s.mobil && s.szelektor === "body"));
    const meretek = css.match(/font-size:\s*[0-9.]+px/g) ?? [];
    assert.ok(meretek.length > 60, `sizes: ${meretek.length}`);
  });

  it("no font size under 13 px, in `font-size` or in the `font:` shorthand", () => {
    for (const m of css.matchAll(/(font-size|font):\s*([0-9.]+)px/g)) {
      assert.ok(Number(m[2]) >= 13, `${m[0]} (${m.index})`);
    }
  });

  it("the body text is at least 16 px, and so is every input on a phone", () => {
    const body = mind.find((s) => !s.mobil && s.szelektor === "body")!;
    assert.ok(Number(/font-size:\s*([0-9.]+)px/.exec(body.torzs)![1]) >= 16);
    const mobilInput = mind.find(
      (s) => s.mobil && s.szelektor.startsWith("input:not"),
    );
    assert.ok(mobilInput, "a phone rule for the inputs");
    assert.ok(
      Number(/font-size:\s*([0-9.]+)px/.exec(mobilInput.torzs)![1]) >= 16,
    );
  });

  it("every text colour is at least 4.5:1 against the lightest card background", () => {
    let db = 0;
    for (const s of mind) {
      if (DISZ.some((d) => s.szelektor.includes(d))) continue;
      for (const m of s.torzs.matchAll(
        /(?<![-\w])color:\s*(#[0-9a-fA-F]{3,6})\b/g,
      )) {
        db += 1;
        if (NARANCSON.some((n) => s.szelektor.includes(n)))
          assert.ok(
            kontraszt(m[1]!, NARANCS) >= 4.5,
            `${s.szelektor}: ${m[1]} on orange`,
          );
        else
          assert.ok(
            kontraszt(m[1]!, KARTYA) >= 4.5,
            `${s.szelektor}: ${m[1]} ${kontraszt(m[1]!, KARTYA).toFixed(2)}`,
          );
      }
    }
    assert.ok(db >= 8, `colours seen: ${db}`);
  });

  it("the muted text colour and the main text colour keep their contrast", () => {
    assert.ok(kontraszt(valtozo("jatek-muted"), KARTYA) >= 7);
    assert.ok(kontraszt(valtozo("jatek-text"), KARTYA) >= 12);
  });
});
