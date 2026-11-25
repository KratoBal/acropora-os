import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { megerositesEgyezik, megerositesHiba } from "./megerosites.js";

/*
  AZ ÚJ JELSZÓ ÉS ALÁÍRÓKÓD KÉTSZER (kártya e0980428). MI PIROSÍT: eltérő megerősítéssel a mentés enged; a hiba mondata nem áll a
  megerősítő mező alatt; üres megerősítésnél a mentés enged; a Beállítások lap egyik űrlapja nem kéri a megerősítést.
*/
describe("a megerősítés", () => {
  it("csak az egyező, nem üres megerősítés enged", () => {
    assert.equal(megerositesEgyezik("titkos123", "titkos123"), true);
    assert.equal(megerositesEgyezik("titkos123", "titkos124"), false);
    assert.equal(megerositesEgyezik("titkos123", ""), false);
    assert.equal(megerositesEgyezik("1234", "1234"), true);
  });

  it("a hiba mondata eltérésnél áll, üres megerősítésnél még nem", () => {
    assert.equal(
      megerositesHiba("jelszo", "titkos123", "titkos12"),
      "A két jelszó nem egyezik.",
    );
    assert.equal(
      megerositesHiba("alairokod", "1234", "1243"),
      "A két aláírókód nem egyezik.",
    );
    assert.equal(megerositesHiba("jelszo", "titkos123", ""), null);
    assert.equal(megerositesHiba("alairokod", "1234", "1234"), null);
  });
});

// a forrás szövegét olvassa, mint a szomszéd wiring specek: renderelő ehhez a csomaghoz ma nincs
describe("a Beállítások lap bekötése", () => {
  const forras = readFileSync(
    join(process.cwd(), "src", "components", "settings.tsx"),
    "utf8",
  );

  it("mindkét űrlap kéri a megerősítést, a mező alatt a hibával", () => {
    assert.match(forras, /label="Új jelszó még egyszer"/);
    assert.match(forras, /label="Új aláírókód még egyszer"/);
    assert.match(
      forras,
      /megerositesHiba\("jelszo", password\.next, password\.confirm\)/,
    );
    assert.match(
      forras,
      /megerositesHiba\("alairokod", signing\.code, signing\.confirm\)/,
    );
  });

  it("a mentés gomb feltétele az egyezés", () => {
    assert.match(
      forras,
      /megerositesEgyezik\(password\.next, password\.confirm\)/,
    );
    assert.match(
      forras,
      /megerositesEgyezik\(signing\.code, signing\.confirm\)/,
    );
  });
});
