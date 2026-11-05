import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { HAMIS_KERDES, type Kerdes } from "../lib/jatek-api.ts";
import { BeadasUrlap } from "./beadas-urlap.tsx";

/*
  WHAT TURNS THIS RED (the submission form, rendered to static HTML). A newsletter checkbox, or a second checkbox of
  any kind (Balázs, 2026-11-05 20:51: "nem kérem"; the design's "Szeretnék Acropora-híreket" option is deliberately
  left out); a rules-acceptance checkbox that is not required or arrives pre-checked; a honeypot that is a type=hidden field, is not out of the tab order, or can
  be autofilled; a text answer without the 200 character limit, or a choice question without its options; a form
  that gives the api's address away; a note that does not link the rules and the privacy notice.
*/
const SZOVEG: Kerdes = {
  ...HAMIS_KERDES,
  id: "q-text",
  type: "TEXT",
  options: [],
};

const html = (kerdes: Kerdes) =>
  renderToStaticMarkup(<BeadasUrlap kerdes={kerdes} />);

describe("a beküldő űrlap", () => {
  it("has exactly one checkbox: the required, unchecked rules acceptance; never a newsletter", () => {
    for (const kerdes of [SZOVEG, HAMIS_KERDES]) {
      const h = html(kerdes);
      const dobozok = h.match(/<input[^>]*type="checkbox"[^>]*>/g) ?? [];
      assert.equal(dobozok.length, 1);
      assert.match(dobozok[0]!, /required/);
      assert.doesNotMatch(dobozok[0]!, /checked/);
      assert.doesNotMatch(h, /hírlevél|newsletter|Acropora-hír|marketing/i);
    }
  });

  it("asks for the e-mail address in an e-mail field that the browser can fill", () => {
    const h = html(SZOVEG);
    assert.match(
      h,
      /<input[^>]*id="jatek-email"[^>]*type="email"|<input[^>]*type="email"[^>]*id="jatek-email"/,
    );
    assert.match(h, /autoComplete="email"|autocomplete="email"/i);
  });

  it("a text question: one text field with the 200 character limit", () => {
    const h = html(SZOVEG);
    assert.match(h, /id="jatek-valasz"/);
    assert.match(h, /maxLength="200"|maxlength="200"/i);
    assert.doesNotMatch(h, /type="radio"/);
  });

  it("a choice question: one radio per option, carrying the option's id, and no free text field", () => {
    const h = html(HAMIS_KERDES);
    for (const lehetoseg of HAMIS_KERDES.options) {
      assert.match(
        h,
        new RegExp(
          `type="radio"[^>]*value="${lehetoseg.id}"|value="${lehetoseg.id}"[^>]*type="radio"`,
        ),
      );
      assert.ok(h.includes(lehetoseg.label));
    }
    assert.equal(
      (h.match(/type="radio"/g) ?? []).length,
      HAMIS_KERDES.options.length,
    );
    assert.doesNotMatch(h, /id="jatek-valasz"/);
  });

  it("the honeypot is a visible-type text field named website, out of the tab order, not autofilled, and hidden by CSS class", () => {
    const h = html(SZOVEG);
    const csali =
      h.match(/<div class="jatek-csali"[^>]*>[\s\S]*?<\/div>/)?.[0] ?? "";
    assert.ok(csali !== "", "the honeypot wrapper");
    assert.match(csali, /name="website"/);
    assert.match(csali, /type="text"/);
    assert.match(csali, /tabindex="-1"|tabIndex="-1"/i);
    assert.match(csali, /autocomplete="off"|autoComplete="off"/i);
    assert.match(csali, /aria-hidden="true"/);
    assert.doesNotMatch(h, /type="hidden"/);
  });

  it("links the rules and the privacy notice, and says the address is for the game only", () => {
    const h = html(SZOVEG);
    assert.match(h, /href="\/jatekszabalyzat"/);
    assert.match(h, /href="\/adatkezeles"/);
    assert.match(h, /csak a játékra és a nyertes értesítésére/);
  });

  it("keeps the api's address and the fake-api switch out of the markup", () => {
    const h = html(SZOVEG);
    assert.doesNotMatch(
      h,
      /JATEK_API_URL|\/jatek\/bekuldes|api-staging|api\.acropora/,
    );
  });
});
