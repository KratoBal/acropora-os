import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { HAMIS_KERDES } from "../lib/jatek-api.ts";
import {
  Gyik,
  Hero,
  KampanySav,
  Lepesek,
  Nyertesek,
} from "./fooldal-szakaszok.tsx";
import { HetiKerdesSzakasz, hetCimke } from "./heti-kerdes.tsx";
import { reszek } from "./visszaszamlalo.tsx";

/*
  WHAT TURNS THIS RED. A countdown that shows a negative or wrong part (a day boundary off by one, seconds that do
  not roll into minutes); a week label that mangles an unexpected shape instead of passing it through; a weekly
  section that hides the "no open question" and "not available" sentences (the visitor would see an empty card); the
  fixed home sections going out with a prototype wording or a newsletter option (the design had both; the real game
  has neither: Balázs, 2026-11-05 20:51).
*/
describe("a visszaszámláló részei", () => {
  it("splits the milliseconds into days, hours, minutes and seconds", () => {
    const ms = (((6 * 24 + 23) * 60 + 59) * 60 + 58) * 1000;
    assert.deepEqual(reszek(ms), { nap: 6, ora: 23, perc: 59, mp: 58 });
    assert.deepEqual(reszek(61_000), { nap: 0, ora: 0, perc: 1, mp: 1 });
  });

  it("never goes below zero", () => {
    assert.deepEqual(reszek(-5000), { nap: 0, ora: 0, perc: 0, mp: 0 });
    assert.deepEqual(reszek(0), { nap: 0, ora: 0, perc: 0, mp: 0 });
  });
});

describe("a hét címkéje", () => {
  it("turns an ISO week into a Hungarian label and passes anything else through", () => {
    assert.equal(hetCimke("2026-W46"), "46. hét");
    assert.equal(hetCimke("2026-W05"), "5. hét");
    assert.equal(hetCimke("karácsony"), "karácsony");
  });
});

describe("a heti kérdés szakasz", () => {
  it("an open question shows the prompt, the form and the countdown card", () => {
    const h = renderToStaticMarkup(
      <HetiKerdesSzakasz
        allapot={{ fajta: "nyitott", kerdes: HAMIS_KERDES, proba: false }}
      />,
    );
    assert.ok(h.includes(HAMIS_KERDES.prompt));
    assert.match(h, /<form/);
    assert.match(h, /VÁLASZADÁSI IDŐ/);
    assert.doesNotMatch(h, /mintakérdés/);
  });

  it("the fake api marks the question as a sample", () => {
    const h = renderToStaticMarkup(
      <HetiKerdesSzakasz
        allapot={{ fajta: "nyitott", kerdes: HAMIS_KERDES, proba: true }}
      />,
    );
    assert.match(h, /Kipróbálható mintakérdés/);
  });

  it("no open question and an unavailable api each say so, without a form", () => {
    const nincs = renderToStaticMarkup(
      <HetiKerdesSzakasz allapot={{ fajta: "nincs" }} />,
    );
    assert.match(nincs, /Most nincs nyitott kérdés/);
    assert.doesNotMatch(nincs, /<form/);
    assert.doesNotMatch(nincs, /VÁLASZADÁSI IDŐ/);
    const nemElerheto = renderToStaticMarkup(
      <HetiKerdesSzakasz allapot={{ fajta: "elerhetetlen" }} />,
    );
    assert.match(nemElerheto, /role="alert"/);
    assert.doesNotMatch(nemElerheto, /<form/);
  });
});

describe("a főoldal állandó szakaszai", () => {
  const h = renderToStaticMarkup(
    <>
      <Hero />
      <KampanySav />
      <Lepesek />
      <Nyertesek />
      <Gyik />
    </>,
  );

  it("carry the hero line and the grand prize", () => {
    assert.match(h, /Egy kérdés\./);
    assert.match(h, /AF Nano Tank/);
    assert.match(h, /src="\/nano\.jpg"/);
  });

  it("the prize card leads to the page's own prize page, in the same window", () => {
    assert.match(h, /<a href="\/fodij">Ismerd meg az akváriumot/);
    assert.doesNotMatch(h, /aquaforest\.eu/);
  });

  it("have neither a prototype wording nor a newsletter option", () => {
    assert.doesNotMatch(h, /prototípus|prototipus|minta forduló/i);
    assert.doesNotMatch(
      h,
      /type="checkbox"|hírlevelet kérnem|Acropora-híreket/i,
    );
  });
});
