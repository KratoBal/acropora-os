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
  that gives the api's address away; a note that does not link the rules and the privacy notice; no name field, or one that is not required.
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
  it("has exactly two checkboxes, the rules acceptance and the data consent, each required and unticked; never a newsletter", () => {
    for (const kerdes of [SZOVEG, HAMIS_KERDES]) {
      const h = html(kerdes);
      const dobozok = h.match(/<input[^>]*type="checkbox"[^>]*>/g) ?? [];
      assert.equal(dobozok.length, 2);
      for (const doboz of dobozok) {
        assert.match(doboz, /required/);
        assert.doesNotMatch(doboz, /checked/);
      }
      assert.match(dobozok[0]!, /id="jatek-szabalyzat-elfogadas"/);
      assert.match(dobozok[1]!, /id="jatek-hozzajarulas"/);
      assert.doesNotMatch(h, /hírlevél|newsletter|Acropora-hír|marketing/i);
    }
  });

  // WHAT TURNS THIS RED (Balázs "A", 2026-11-06 14:29 UTC): the publication of the winner's data back inside the CONSENT box
  // (it is a condition of the rules, GDPR 6(1)(b), not a consent), or missing from the RULES box (the player must see it
  // at the box that makes it a condition); the two boxes merged; a link missing.
  it("the two acceptances read as the privacy notice says: the rules box carries the publication condition, the consent box only the processing, both linking their documents", () => {
    const h = html(SZOVEG).replace(/<!-- -->/g, "");
    assert.match(
      h,
      /Elfogadom a <a href="\/jatekszabalyzat"[^>]*>játékszabályzatot<\/a>, beleértve, hogy nyertesség esetén a rövidített nevem, részben kitakart e-mail-címem és a nyereményem megjelenik a játék oldalán és a fődíj élő sorsolásán\./,
    );
    assert.match(
      h,
      /Hozzájárulok, hogy az <a href="\/adatkezeles"[^>]*>adatkezelési tájékoztató<\/a> szerint kezeljétek az adataimat\./,
    );
    const szabalyzat = /Elfogadom a [\s\S]*?<\/label>/.exec(h)![0];
    const hozzajarulas = /Hozzájárulok, hogy [\s\S]*?<\/label>/.exec(h)![0];
    // the rules box does not carry the consent (apart, as the notice 3.1 requires) ...
    assert.doesNotMatch(szabalyzat, /Hozzájárulok|adatkezelési tájékoztató/);
    // ... and the consent box does not carry the publication
    assert.doesNotMatch(hozzajarulas, /megjelen|nyertes|kitakart|sorsol/);
  });

  it("asks for the name in a required text field the browser can fill, and says the winner is shown shortened", () => {
    for (const kerdes of [SZOVEG, HAMIS_KERDES]) {
      const h = html(kerdes);
      const mezo = h.match(/<input[^>]*id="jatek-nev"[^>]*>/)?.[0] ?? "";
      assert.match(mezo, /required/);
      assert.match(mezo, /autoComplete="name"|autocomplete="name"/i);
      assert.match(mezo, /maxLength="120"|maxlength="120"/i);
      assert.match(h, /rövidítve \(például Kovács P\.\)/);
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
