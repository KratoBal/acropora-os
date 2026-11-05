import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import {
  ADATKEZELES,
  JATEKSZABALYZAT,
  JOGI_DOKUMENTUMOK,
  kitoltendoDb,
} from "../lib/jogi-szovegek.ts";
import { JogiOldal } from "./jogi-oldal.tsx";
import { OldalKeret } from "./oldal-keret.tsx";

/*
  WHAT TURNS THIS RED. A draft page without its draft warning above the text; a [KITÖLTENDŐ] mark that the page
  does not show (a mark that is in the data but missing from the page would let a gap go out unseen); a section
  that is missing; a frame without the links to the three pages.
*/
describe("a jogi oldal", () => {
  it("shows the draft warning first, then every section, and every [KITÖLTENDŐ] mark of the data", () => {
    for (const d of JOGI_DOKUMENTUMOK) {
      const h = renderToStaticMarkup(<JogiOldal dokumentum={d} />);
      assert.ok(
        h.indexOf("vazlat-jelzes") < h.indexOf(d.szakaszok[0]!.cim),
        d.azonosito,
      );
      assert.ok(h.includes("VÁZLAT"), d.azonosito);
      for (const szakasz of d.szakaszok)
        assert.ok(h.includes(szakasz.cim), szakasz.cim);
      // a szakaszok jelolesei + a vazlat-jelzes sajat egy emlitese
      const jelzesben = d.vazlat_jelzes.split("[KITÖLTENDŐ").length - 1;
      assert.equal(
        (h.match(/\[KITÖLTENDŐ/g) ?? []).length,
        kitoltendoDb(d) + jelzesben,
        d.azonosito,
      );
    }
  });

  it("the two documents are different pages with their own title", () => {
    const a = renderToStaticMarkup(<JogiOldal dokumentum={JATEKSZABALYZAT} />);
    const b = renderToStaticMarkup(<JogiOldal dokumentum={ADATKEZELES} />);
    assert.ok(
      a.includes("Játékszabályzat") &&
        !a.includes("Adatkezelési tájékoztató</h2>"),
    );
    assert.ok(
      b.includes("Adatkezelési tájékoztató") &&
        b.includes('data-dokumentum="adatkezeles"'),
    );
  });
});

describe("az oldal kerete", () => {
  it("has the title and the links to the question, the rules and the privacy notice", () => {
    const h = renderToStaticMarkup(
      <OldalKeret>
        <p>tartalom</p>
      </OldalKeret>,
    );
    assert.ok(h.includes("Acropora nyereményjáték"));
    assert.ok(h.includes("tartalom"));
    for (const href of ["/", "/jatekszabalyzat", "/adatkezeles"])
      assert.ok(h.includes(`href="${href}"`), href);
  });
});
