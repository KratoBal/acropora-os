import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  kezdoValaszto,
  valasztasUtan,
  valasztoraKoppint,
} from "./worksheet-pickers";

describe("melyik választó áll nyitva", () => {
  it("a képernyő zárt választókkal indul", () => {
    assert.equal(kezdoValaszto(), null);
  });

  it("koppintásra nyílik", () => {
    assert.equal(valasztoraKoppint(null, "partner"), "partner");
    assert.equal(valasztoraKoppint(null, "helyszin"), "helyszin");
  });

  it("ugyanarra koppintva bezár", () => {
    assert.equal(valasztoraKoppint("partner", "partner"), null);
    assert.equal(valasztoraKoppint("helyszin", "helyszin"), null);
  });

  /**
   * EGYSZERRE EGY VALASZTO -- ES EZ A JELENTES LENYEGE. A partner utan rogton a
   * helyszin teljes listaja nyilt ki alatta, es kivulrol ez ugyanaz a kep,
   * mintha a partner-lista maradt volna ott.
   */
  it("a másikra koppintva az előző becsukódik", () => {
    assert.equal(valasztoraKoppint("partner", "helyszin"), "helyszin");
    assert.equal(valasztoraKoppint("helyszin", "partner"), "partner");
  });

  it("választás után mind a kettő zárva", () => {
    assert.equal(valasztasUtan(), null);
  });

  /**
   * ES EGY ALLITAS MAGARA A SZERKEZETRE: EGY ertek van, nem ketto. Ket
   * fuggetlen jelzo megengedne, hogy mind a ketto nyitva legyen -- epp az a
   * mai kep, amire a jelentes szol. Ezt csak ugy lehet allitani, hogy VEGIG
   * probaljuk: nincs olyan lepes-sorozat, ami ket nyitottat adna.
   */
  it("nincs olyan lépés, ami után kettő állna nyitva", () => {
    const allapotok: Array<"partner" | "helyszin" | null> = [
      null,
      "partner",
      "helyszin",
    ];
    for (const kezdo of allapotok) {
      for (const melyik of ["partner", "helyszin"] as const) {
        const uj = valasztoraKoppint(kezdo, melyik);
        // AZ EREDMENY EGYETLEN ERTEK: tobbet szerkezetileg nem tud hordozni.
        assert.ok(uj === null || uj === "partner" || uj === "helyszin");
      }
    }
  });
});
