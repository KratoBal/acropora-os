import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { MobilGomb, gombLatszik } from "./mobil-gomb.tsx";

/*
  WHAT TURNS THIS RED (Balázs, 2026-11-06: the fixed button sat on the prize card's text). The button shown while the
  question section is on screen or already scrolled past; hidden when the question is still ahead; a first render
  that is hidden (the page must show it before any script runs); a hidden button that stays in the tab order or
  in the accessibility tree.
*/
describe("a mobilon rögzített gomb", () => {
  it("shows only while the question section is still ahead of the reader", () => {
    assert.equal(gombLatszik({ metszi: false, tetejeFelett: false }), true);
    assert.equal(gombLatszik({ metszi: true, tetejeFelett: false }), false);
    assert.equal(gombLatszik({ metszi: false, tetejeFelett: true }), false);
  });

  it("the first render is the visible button, a plain link to the question", () => {
    const h = renderToStaticMarkup(<MobilGomb />);
    assert.match(h, /href="\/#heti-kerdes"/);
    assert.match(h, /Ugrás a heti kérdéshez/);
    assert.doesNotMatch(h, /data-rejtett|aria-hidden|tabindex/i);
  });

  it("the hidden state leaves the tab order and the accessibility tree, and the CSS hides it", () => {
    const forras = readFileSync(
      join(process.cwd(), "src", "components", "mobil-gomb.tsx"),
      "utf8",
    );
    assert.match(forras, /tabIndex=\{latszik \? undefined : -1\}/);
    assert.match(forras, /aria-hidden=\{latszik \? undefined : true\}/);
    const css = readFileSync(
      join(process.cwd(), "src", "app", "jatek.css"),
      "utf8",
    );
    assert.match(
      css,
      /\.jatek-mobile-cta\[data-rejtett="true"\]\s*\{\s*display:\s*none/,
    );
  });
});
