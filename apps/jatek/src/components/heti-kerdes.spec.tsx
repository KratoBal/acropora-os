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

  it("an open question with a prize shows its picture (from the page's own path), name and description instead of the gift box", () => {
    const h = renderToStaticMarkup(
      <HetiKerdesSzakasz
        allapot={{
          fajta: "nyitott",
          proba: false,
          kerdes: {
            ...HAMIS_KERDES,
            prize: {
              name: "Aquaforest AF Nano Tank",
              description: "Egy kis akvárium.",
              hasImage: true,
            },
          },
        }}
      />,
    );
    assert.match(h, /src="\/api\/nyeremeny-kep\/proba-kerdes"/);
    assert.match(h, /alt="Aquaforest AF Nano Tank"/);
    assert.match(h, /<h3>Aquaforest AF Nano Tank<\/h3>/);
    assert.match(h, /Egy kis akvárium\./);
    assert.doesNotMatch(h, /jatek-gift-art/);
    assert.doesNotMatch(h, /hamarosan kiderül/);
  });

  it("a prize without a picture keeps the gift box with its name; no prize at all says it is not known yet", () => {
    const nevvel = renderToStaticMarkup(
      <HetiKerdesSzakasz
        allapot={{
          fajta: "nyitott",
          proba: false,
          kerdes: {
            ...HAMIS_KERDES,
            prize: { name: "Pumpa", description: null, hasImage: false },
          },
        }}
      />,
    );
    assert.match(nevvel, /jatek-gift-art/);
    assert.match(nevvel, /<h3>Pumpa<\/h3>/);
    assert.doesNotMatch(nevvel, /nyeremeny-kep/);
    const nincs = renderToStaticMarkup(
      <HetiKerdesSzakasz
        allapot={{ fajta: "nyitott", kerdes: HAMIS_KERDES, proba: false }}
      />,
    );
    assert.match(nincs, /hamarosan kiderül/);
  });

  it("with no open question and a next one: its prize picture and name instead of the gift box, 'Következő kérdés hamarosan' and the countdown to its opening", () => {
    const h = renderToStaticMarkup(
      <HetiKerdesSzakasz
        allapot={{
          fajta: "nincs",
          kovetkezo: {
            id: "q2",
            week: "2026-W47",
            opensAt: "2026-11-14T21:00:00.000Z",
            prize: { name: "Pumpa", description: null, hasImage: true },
          },
        }}
      />,
    );
    assert.match(h, /Most nincs nyitott kérdés/);
    assert.match(h, /src="\/api\/nyeremeny-kep\/q2"/);
    assert.match(h, /<h3>Pumpa<\/h3>/);
    assert.match(h, /Következő kérdés hamarosan/);
    assert.match(h, /data-testid="visszaszamlalo"/);
    assert.match(h, /Visszaszámláló a következő kérdés megnyitásáig/);
    assert.doesNotMatch(h, /jatek-gift-art/);
    assert.doesNotMatch(h, /<form/);
    assert.doesNotMatch(h, /VÁLASZADÁSI IDŐ/);
  });

  it("a next question without a prize still counts down, with the gift box and no invented name", () => {
    const h = renderToStaticMarkup(
      <HetiKerdesSzakasz
        allapot={{
          fajta: "nincs",
          kovetkezo: {
            id: "q2",
            week: "2026-W47",
            opensAt: "2026-11-14T21:00:00.000Z",
            prize: null,
          },
        }}
      />,
    );
    assert.match(h, /jatek-gift-art/);
    assert.match(h, /Következő kérdés hamarosan/);
    assert.match(h, /data-testid="visszaszamlalo"/);
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

  it("the winners list shows the shortened names only, with the draw and the prize; with none yet it keeps the empty box", () => {
    const lista = renderToStaticMarkup(
      <Nyertesek
        nyertesek={[
          {
            kind: "WEEKLY",
            week: "2026-W45",
            name: "Kovács P.",
            prizeName: "Aquaforest AF Nano Tank",
            drawnAt: "2026-11-14T20:00:00.000Z",
          },
          {
            kind: "CHRISTMAS",
            week: null,
            name: "Nagy A.",
            prizeName: null,
            drawnAt: "2026-12-26T21:00:00.000Z",
          },
        ]}
      />,
    );
    assert.match(lista, /data-testid="nyertesek"/);
    assert.match(lista, /<b>Kovács P\.<\/b>/);
    assert.match(lista, /45\. hét · Aquaforest AF Nano Tank/);
    assert.match(lista, /Karácsonyi fődíj/);
    assert.doesNotMatch(lista, /jatek-empty-winners|Még a rajt előtt/);
    assert.match(renderToStaticMarkup(<Nyertesek />), /jatek-empty-winners/);
  });

  it("have neither a prototype wording nor a newsletter option", () => {
    assert.doesNotMatch(h, /prototípus|prototipus|minta forduló/i);
    assert.doesNotMatch(
      h,
      /type="checkbox"|hírlevelet kérnem|Acropora-híreket/i,
    );
  });
});
