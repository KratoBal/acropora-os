import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readDosing } from "./dosing-reader.js";
import { extractPageStatement } from "./page-extract.js";

/**
 * THE MANUFACTURER'S DOSING FROM THE DESCRIPTION (Product Knowledge 2a, card
 * 85c38ab1). WHAT TURNS IT RED: a dose read from an ambiguous page (two doses,
 * a range, a conditional dose, a unit a person has to interpret), the pack
 * size taken as a dose, or a clean manufacturer sentence not read at all.
 */
describe("a gyártói adagolás a leírásból", () => {
  it("egy egyértelmű adag: angol, német, magyar, a mondat szórendjétől függetlenül", () => {
    const cases: [string, string][] = [
      ["Dose 5 ml per 100 litres of aquarium water daily.", "5 ml/100 L/day"],
      ["Add 1 drop per 100 l daily.", "1 drop/100 L/day"],
      ["Täglich 1 Tropfen je 100 Liter Aquarienwasser.", "1 drop/100 L/day"],
      ["1 ml pro 100 l wöchentlich.", "1 ml/100 L/week"],
      ["Adagolás: naponta 2 ml 100 literenként.", "2 ml/100 L/day"],
      ["100 liter vízhez hetente 10 ml-t adjunk.", "10 ml/100 L/week"],
      ["Dose 0,5 ml/100 l/day.", "0.5 ml/100 L/day"],
      ["Dose 2 ml per 100 l, 2-3 times per week.", "2 ml/100 L, 2-3/week"],
      ["Dose 2 ml per 100 l twice a week.", "2 ml/100 L, 2/week"],
    ];
    for (const [text, want] of cases) {
      const r = readDosing(text);
      assert.equal(r.raw, want, text);
      assert.ok(r.excerpt, text);
    }
  });

  it("a kivonat a nyers szövegből jön, ékezettel, a találat mondatából", () => {
    const r = readDosing(
      "Prémium aminosav-koncentrátum. Adagolás: naponta 1 csepp 100 literenként. Tartalom: 100 ml.",
    );
    assert.equal(r.raw, "1 drop/100 L/day");
    assert.match(r.excerpt ?? "", /naponta 1 csepp 100 literenként/);
  });

  it("a kiszerelés nem adag, és nem is akadályozza a valódit", () => {
    assert.equal(readDosing("Inhalt: 500 ml.").raw, null);
    const r = readDosing(
      "500 ml is enough for 10000 l. Dose 1 ml per 100 l daily.",
    );
    assert.equal(r.raw, "1 ml/100 L/day");
  });

  it("ugyanaz az adag kétszer: egy érték", () => {
    const r = readDosing(
      "Dose 1 ml per 100 l daily. In short: 1 ml/100 l/day.",
    );
    assert.equal(r.raw, "1 ml/100 L/day");
  });

  it("bizonytalan oldal: nincs érték, és a megjegyzés megmondja, miért", () => {
    const refused: [string, RegExp][] = [
      [
        "Dose 1 ml per 100 l daily. Reefs with SPS: 2 ml per 100 l daily.",
        /több eltérő adag/,
      ],
      ["Dose 1-2 ml per 100 l daily.", /tartomány/],
      ["Dose up to 3 ml per 100 l daily.", /feltételes mennyiség/],
      [
        "Dose 1 ml per 100 l daily. Adjust according to test results.",
        /feltételhez kötött/,
      ],
      ["In the first week dose 2 ml per 100 l daily.", /feltételhez kötött/],
      ["Dose 1 ml per 25 gallons daily.", /értelmezendő egység/],
      ["Add 1 capful per 100 l weekly.", /értelmezendő egység/],
      ["Dose 1 g per 100 l daily.", /értelmezendő egység/],
      ["Dose 5 ml per 100 l every other day.", /nem napi és nem heti/],
      [
        "Dose 5 ml per 100 l daily, or 30 ml per 100 l weekly.",
        /egy mondatban több/,
      ],
      ["Dose 1 ml daily.", /hiányzik a mennyiség vagy a vízmennyiség/],
    ];
    for (const [text, why] of refused) {
      const r = readDosing(text);
      assert.equal(r.raw, null, text);
      assert.equal(r.excerpt, null, text);
      assert.ok(
        r.notes.some((n) => why.test(n)),
        `${text} -> ${JSON.stringify(r.notes)}`,
      );
    }
  });

  it("egy olvashatatlan adag-mondat a jó mondat mellett is visszatartja az értéket", () => {
    const r = readDosing(
      "Dose 1 ml per 100 l daily. US: 1 ml per 25 gallons daily.",
    );
    assert.equal(r.raw, null);
  });

  it("HTML-sortörés mondathatár", () => {
    const r = readDosing("Dose 1 ml per 100 l daily<br>Content: 500 ml");
    assert.equal(r.raw, "1 ml/100 L/day");
  });

  it("a lap kivonatában dosing mező, a leírásból", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@type": "Product",
      name: "Amino",
      description: "Dose 1 drop per 100 l daily.",
    })}</script>`;
    const statement = extractPageStatement(html);
    const dosing = statement.values.find((v) => v.field === "dosing");
    assert.equal(dosing?.raw, "1 drop/100 L/day");
    assert.match(dosing?.excerpt ?? "", /Product\.description/);
  });
});
