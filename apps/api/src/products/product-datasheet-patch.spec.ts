import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  changedHusbandryFacts,
  datasheetPatchOf,
  filledNameFields,
} from "./product-datasheet-patch.js";

/*
  MI PIROSIT (kartya 20b0dd47, S2): egy nem adott mezo is bekerul a patchbe (egy nev-frissites nullazna a tobbit); az ures
  vagy csak szokozos nev nem null (a torles elmarad); a nev nincs levagva; az elhelyezesi igeny elveszik, mikor a nevek
  mellett adott; adatlap-iras jon letre, amikor semmi nem adott.
*/
describe("az adatlap-patch a termek-frissitesbol", () => {
  it("semmi adatlap-mezo: nincs iras (a sor nem is jon letre)", () => {
    assert.equal(datasheetPatchOf({}), null);
  });

  it("csak az adott mezok kerulnek bele, a tobbi kimarad", () => {
    assert.deepEqual(datasheetPatchOf({ angolNev: "Staghorn coral" }), {
      angolNev: "Staghorn coral",
    });
    assert.deepEqual(datasheetPatchOf({ fenyIgeny: "EROS" }), {
      fenyIgeny: "EROS",
    });
  });

  it("a nev szokozei levagva, az ures vagy csak szokozos nev null (torles)", () => {
    assert.deepEqual(
      datasheetPatchOf({
        magyarNev: "  Szarvkorall ",
        angolNev: "   ",
        nemetNev: "",
      }),
      { magyarNev: "Szarvkorall", angolNev: null, nemetNev: null },
    );
  });

  it("a null kifejezetten torol, az elhelyezesi igeny a nevek mellett is megmarad", () => {
    assert.deepEqual(
      datasheetPatchOf({
        nemetNev: null,
        fenyIgeny: "GYENGE",
        aramlasIgeny: null,
      }),
      { nemetNev: null, fenyIgeny: "GYENGE", aramlasIgeny: null },
    );
  });
});

describe("a kitoltott nev-mezok (a megtagadas feloldasahoz)", () => {
  it("csak a nem ures szoveggel kitoltott nevek mezo-jelei; a torles es a hianyzo nem", () => {
    assert.deepEqual(filledNameFields(null), []);
    assert.deepEqual(
      filledNameFields(
        datasheetPatchOf({
          magyarNev: "Szarvkorall",
          angolNev: null,
          nemetNev: "  ",
          fenyIgeny: "EROS",
        }),
      ),
      ["MAGYAR_NEV"],
    );
    assert.deepEqual(
      filledNameFields(datasheetPatchOf({ angolNev: "a", nemetNev: "b" })),
      ["ANGOL_NEV", "NEMET_NEV"],
    );
  });
});

/*
  MI PIROSIT (V2.2, barracuda #2374): egy nem adott kulcs valtozasnak szamit; a tarolttal egyezo ertek valtozasnak szamit; az
  angol vagy a nemet nev valtozasnak szamit; a sor nelkuli termeken a null-null irasa valtozasnak szamit.
*/
describe("a tartasi tenyek valtozasa az adatlap-patchben", () => {
  const stored = {
    magyarNev: "Szarvkorall",
    fenyIgeny: "KOZEPES",
    aramlasIgeny: null,
  };

  it("csak az adott, a tarolttol elterő tartasi teny szamit", () => {
    assert.deepEqual(
      changedHusbandryFacts({ magyarNev: "Agancskorall" }, stored),
      ["magyarNev"],
    );
    assert.deepEqual(
      changedHusbandryFacts(
        { fenyIgeny: "EROS", aramlasIgeny: "GYENGE" },
        stored,
      ),
      ["fenyIgeny", "aramlasIgeny"],
    );
    assert.deepEqual(changedHusbandryFacts({ magyarNev: null }, stored), [
      "magyarNev",
    ]);
  });

  it("a visszairt azonos ertek, a nem adott kulcs es az angol vagy nemet nev nem szamit", () => {
    assert.deepEqual(
      changedHusbandryFacts({ magyarNev: "Szarvkorall" }, stored),
      [],
    );
    assert.deepEqual(
      changedHusbandryFacts({ fenyIgeny: "KOZEPES" }, stored),
      [],
    );
    assert.deepEqual(
      changedHusbandryFacts(
        { angolNev: "Staghorn", nemetNev: "Hirsch" },
        stored,
      ),
      [],
    );
    assert.deepEqual(changedHusbandryFacts(null, stored), []);
  });

  it("sor nelkuli termeken a tarolt ertek null: egy ertek valtozas, a null nem", () => {
    assert.deepEqual(changedHusbandryFacts({ fenyIgeny: "EROS" }, null), [
      "fenyIgeny",
    ]);
    assert.deepEqual(changedHusbandryFacts({ fenyIgeny: null }, null), []);
  });
});
