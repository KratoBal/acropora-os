import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { datasheetPatchOf } from "./product-datasheet-patch.js";

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
